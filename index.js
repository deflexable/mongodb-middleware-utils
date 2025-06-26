import { MongoClient } from 'mongodb';
import { Binary, BSONRegExp, BSONSymbol, Code, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from 'mongodb/lib/bson';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Scope, transformPunctuation } from './peripherals';
import { generateFulltextIndex } from './worker';

const getDirname = () => {
    if (typeof __dirname !== 'undefined') return __dirname;
    return dirname(fileURLToPath(import.meta.url));
}

const __dirnamePath = getDirname();

const one_mb = 1024 * 1024;

export const FULLTEXT_ARRAY_PREFIX = '__fta_';
export const RANDOMIZER_FIELD = '__rdz';
const RANDOMIZE_CHUNK_SIZE = 3;
const MAX_DOC_SIZE = one_mb * 15;

export class MongoClientHack extends MongoClient {
    constructor({ map, url, tokenizer, indexNotice, options }) {
        super(url, options);
        this.interceptMap = { map, tokenizer, indexNotice };
        overheadConfig(super.db.bind(this), this.interceptMap);
    }

    get db() {
        return interceptDB(super.db.bind(this), this.interceptMap);
    }
    __intercepted = true;
};

export const proxyClient = (interceptMap) => (client) => {
    if (client.__intercepted) throw `this MongoClient instance was previously intercepted`;
    overheadConfig(client.db.bind(client), interceptMap);

    const originalDbInstance = client.db.bind(client);
    client.db = interceptDB(originalDbInstance, interceptMap);
    client.interceptMap = interceptMap;
    client.__intercepted = true;
}

const overheadConfig = (dbRef, interceptMap) => {
    const { map, tokenizer, indexNotice } = interceptMap;

    if (tokenizer !== undefined && typeof tokenizer !== 'function')
        throw `expected a function for field:"tokenizer" but got ${tokenizer}`;

    if (
        indexNotice !== undefined &&
        !['warn', 'error', 'off'].some(v => indexNotice === v)
    ) throw `expected either a function or any of 'warn', 'error', 'off' for field:"indexNotice" but got ${indexNotice}`;

    Object.entries(map || {}).forEach(([dbName, colObj]) => {

        Object.entries(colObj).forEach(([colName, value]) => {
            const logRef = `dbName(${dbName}), collectionName(${colName})`;
            const { fulltext, random, safeOverhead, overhead } = value || {};

            if (fulltext) {
                if (Array.isArray(fulltext)) {
                    if (fulltext.filter(v => typeof v !== 'string' || v.includes('.') || !v.trim()).length) {
                        throw `invalid interception value in ${logRef}, fulltext array must contain a non empty string without "." value but got ${JSON.stringify(fulltext)}`;
                    } else if (!fulltext.length) throw `invalid interception value in ${logRef}, fulltext array must not be empty`;
                    else if (fulltext.filter((v, i, a) => a.indexOf(v) === i).length !== fulltext.length)
                        throw `invalid interception value in ${logRef}, fulltext array must not contain duplicate value but got ${fulltext}`;
                } else if (typeof fulltext !== 'string' || fulltext.includes('.')) {
                    throw `invalid interception value in ${logRef}, fulltext must either be a string without "." or array but got ${fulltext}`;
                } else if (!fulltext.trim()) throw `invalid interception value in ${logRef}, fulltext must not be empty`;
            }
            if (random !== undefined && typeof random !== 'boolean')
                throw `invalid interception value in ${logRef}, random should be a boolean value but got ${value}`;
            if (safeOverhead && !overhead)
                throw `"safeOverhead" should only be true when "overhead" is true`;

            if (overhead && !Scope.listeningFulltext[logRef] && (fulltext || random)) {
                Scope.listeningFulltext[logRef] = true;

                const colRef = dbRef(dbName).collection(colName);
                const stream = colRef.watch();
                const textArr = fulltext ? Array.isArray(fulltext) ? fulltext : [fulltext] : [];

                console.log('listening overhead:', colName);
                stream.on('change', async ({ operationType, fullDocument, updateDescription, documentKey }) => {
                    if (operationType === 'delete') return;
                    const { _id } = documentKey;
                    const thisData = fullDocument || await colRef.findOne({ _id });
                    if (!thisData) return;

                    const expectingText = fulltext ?
                        operationType === 'insert' ? textArr.filter(v => !thisData[`${FULLTEXT_ARRAY_PREFIX}${v}`]) :
                            Object.keys(updateDescription?.updatedFields || {}).filter(v => textArr.includes(v)) : [];

                    if (
                        expectingText.length ||
                        (random && !thisData[RANDOMIZER_FIELD])
                    ) {
                        console.log('overhead working');
                        if (safeOverhead) {
                            const freeBytes = MAX_DOC_SIZE - JSON.stringify({
                                ...thisData,
                                ...Object.fromEntries(expectingText.map(k => [k]))
                            }).length;
                            if (freeBytes > 0) {
                                const indexes = await Promise.all(expectingText.map(async k => {
                                    const thisText = thisData[k];
                                    const tokenText = typeof thisText === 'string' && await tokenizer?.(thisText);
                                    return [k, await getFulltextArray(tokenizer ? tokenText : thisText)];
                                }));
                                const limitedIndexes = indexes.map(([k]) => [k, new Set([])]);
                                let shouldBreak, sizer = 0;

                                for (let i = 0; i < indexes.length; i++) {
                                    if (shouldBreak) break;
                                    for (let x = 0; x < indexes[i][1].length; x++) {
                                        const element = indexes[i][1][x];

                                        if (!((shouldBreak = (sizer += (element.length + 4))) >= freeBytes)) {
                                            limitedIndexes[i][1].add(element);
                                        } else break;
                                    }
                                }

                                colRef.updateOne({ _id }, {
                                    $set: {
                                        ...Object.fromEntries(
                                            limitedIndexes.map(([k, v]) =>
                                                [`${FULLTEXT_ARRAY_PREFIX}${k}`, [...v]]
                                            ).filter(v => v[1].length)
                                        ),
                                        ...thisData[RANDOMIZER_FIELD] ? {} : { [RANDOMIZER_FIELD]: Math.random() }
                                    }
                                });
                            } else if (!thisData[RANDOMIZER_FIELD]) {
                                colRef.updateOne({ _id }, {
                                    $set: { [RANDOMIZER_FIELD]: Math.random() }
                                });
                            }
                        } else {
                            const indexes = await Promise.all(expectingText.map(async k => {
                                const thisText = thisData[k];
                                const thisToken = typeof thisText === 'string' && (await tokenizer?.(thisText));
                                return [
                                    `${FULLTEXT_ARRAY_PREFIX}${k}`,
                                    await getFulltextArray(tokenizer ? thisToken : thisText)
                                ];
                            }));

                            colRef.updateOne({ _id }, {
                                $set: {
                                    ...Object.fromEntries(indexes),
                                    ...thisData[RANDOMIZER_FIELD] ? {} : { [RANDOMIZER_FIELD]: Math.random() }
                                }
                            });
                        }
                    }
                });
            }
        });
    });
}

/**
 * 
 * @param {MongoClient['db']} dbRef 
 * @param {*} interceptMap 
 * @returns 
 */
const interceptDB = (dbRef, interceptMap) => function () {
    const { map, tokenizer, indexNotice } = interceptMap;
    const notifyIndex = indexNotice !== 'off' && indexNotice;

    const dbInstance = dbRef(...[...arguments]),
        [thisDbName] = [...arguments];

    let collectionX = function () {
        const thisColArgs = [...arguments],
            colInstance = dbInstance.collection(...thisColArgs),
            // interception mappings
            thisCol = {},
            thisColName = thisColArgs[0];

        Object.entries(map || {}).forEach(([dbName, colObj]) => {

            Object.entries(colObj).forEach(([colName, valueX]) => {
                const value = { ...valueX, tokenizer };
                if (thisDbName === dbName && thisColName === colName && (value?.fulltext || value?.random)) {
                    const { fulltext, random } = value;

                    const tipOff = (tip) => {
                        if (tip?.$text?.$search && fulltext) {
                            const sf = tip.$text.$field || fulltext,
                                searchField = Array.isArray(sf) ? sf : [sf];

                            if (searchField.filter((v, i, a) => a.indexOf(v) === i).length !== searchField.length)
                                throw `$field must not contain duplicate values`;

                            tip = {
                                ...tip,
                                $or: [
                                    ...tip?.$or || [],
                                    ...searchField.map(field => ({
                                        [`${FULLTEXT_ARRAY_PREFIX}${field}`]: {
                                            $in: [serializeSearch(tip?.$text?.$search)]
                                        }
                                    }))
                                ]
                            };
                            delete tip.$text;
                        }
                        return tip;
                    }

                    const cleanUpResult = (res) => {
                        const hits = (Array.isArray(res) ? res : [res]).map(doc => {
                            if (!doc) return doc;
                            const n = { ...doc };

                            Object.keys(doc).forEach(k => {
                                if (
                                    k.startsWith(FULLTEXT_ARRAY_PREFIX) ||
                                    k === RANDOMIZER_FIELD
                                ) delete n[k];
                            });
                            return n;
                        });

                        return Array.isArray(res) ? hits : hits[0];
                    };

                    const buildUpdateInterception = async (d) => {

                        if (isRawObject(d)) {
                            d = { ...d };
                            if (d.$set) d.$set = await buildInterception(d.$set, value);
                            if (d.$setOnInsert) d.$setOnInsert = await buildInterception(d.$setOnInsert, value);
                            if (d.$unset) {
                                (Array.isArray(fulltext) ? fulltext : [fulltext]).forEach(v => {
                                    if (d.$unset[v]) d.$unset[`${FULLTEXT_ARRAY_PREFIX}${v}`] = true;
                                });
                            }
                        }
                        return d;
                    }

                    thisCol.insertOne = async function () {
                        return (await colInstance.insertOne(
                            await buildInterception([...arguments][0], value),
                            [...arguments][1]
                        ));
                    };

                    thisCol.insertMany = async function () {
                        return (await colInstance.insertMany(
                            await Promise.all([...arguments][0].map(v => buildInterception(v, value))),
                            [...arguments][1]
                        ));
                    };

                    ['updateOne', 'updateMany'].forEach(op => {

                        thisCol[op] = async function () {
                            const a = [...arguments];
                            const filterObj = tipOff(a[0]);

                            if (notifyIndex) await checkIndex(colInstance.find(filterObj).limit(1), indexNotice);
                            return (await colInstance[op](
                                filterObj,
                                await buildUpdateInterception(a[1]),
                                a[2]
                            ));
                        };
                    });

                    thisCol.replaceOne = async function () {
                        const a = [...arguments];
                        const filterObj = tipOff(a[0]);

                        if (notifyIndex) await checkIndex(colInstance.find(filterObj).limit(1), indexNotice);

                        return await colInstance.replaceOne(
                            filterObj,
                            await buildInterception(a[1], value),
                            a[2]
                        );
                    };

                    thisCol.bulkWrite = async function () {
                        let [tip, ...rest] = [...arguments];

                        return await colInstance.bulkWrite(
                            await Promise.all(tip.map(async v => {
                                const b = {};
                                await Promise.all(Object.entries(v).map(async ([key, obj]) => {
                                    if (key !== 'insertOne' && notifyIndex)
                                        await checkIndex(colInstance.find(obj.filter).limit(1), indexNotice);

                                    b[key] = {
                                        ...obj,
                                        ...obj.filter ? { filter: tipOff(obj.filter) } : {},
                                        ...obj.arrayFilters ? {} : { arrayFilters: obj.arrayFilters.map(tipOff) },
                                        ...obj.document ? { document: await buildInterception(obj.document, value) } : {},
                                        ...obj.replacement ? { replacement: await buildInterception(obj.replacement, value) } : {},
                                        ...obj.update ? { update: await buildUpdateInterception(obj.update, value) } : {}
                                    };
                                }));
                                return b;
                            })),
                            ...rest
                        );
                    }

                    thisCol.find = function () {
                        const [tip, ...rest] = [...arguments];

                        const findInstance = colInstance.find(tipOff(tip), ...rest),
                            prevToArray = findInstance.toArray.bind(findInstance);

                        findInstance.toArray = async () => {
                            if (notifyIndex) await checkIndex(findInstance.clone().limit(1), indexNotice);

                            return cleanUpResult(await prevToArray());
                        }

                        return findInstance;
                    }

                    thisCol.findOne = async function () {
                        let [tip, ...rest] = [...arguments];
                        const filter = tipOff(tip);

                        if (notifyIndex) await checkIndex(colInstance.find(filter).limit(1), indexNotice);

                        const d = await colInstance.findOne(filter, ...rest);
                        return cleanUpResult(d);
                    };

                    thisCol.watch = function () {
                        const [pipeline, ...rest] = [...arguments];
                        const streamInstance = colInstance.watch(Array.isArray(pipeline) ? pipeline.map(tipOff) : tipOff(pipeline), ...rest),
                            mutatedStream = {};
                        const listenerMap = {};

                        ['on', 'once', 'prependListener', 'addListener', 'prependOnceListener'].forEach(method => {
                            mutatedStream[method] = (event, callback) => {

                                if (event === 'change') {
                                    const processId = `${Math.random()}`;
                                    listenerMap[processId] = s => {
                                        const h = s;
                                        if (h.fullDocument)
                                            h.fullDocument = cleanUpResult(h.fullDocument);
                                        if (h.fullDocumentBeforeChange)
                                            h.fullDocumentBeforeChange = cleanUpResult(h.fullDocumentBeforeChange);
                                        if (h.updateDescription?.updatedFields)
                                            h.updateDescription.updatedFields = cleanUpResult(h.updateDescription.updatedFields)

                                        callback?.(h);
                                    }

                                    if (!callback.prototype) callback.prototype = {};
                                    if (!callback.prototype.__cloneMongodbListener)
                                        callback.prototype.__cloneMongodbListener = [];

                                    callback.prototype.__cloneMongodbListener.push(processId);
                                    return streamInstance[method]('change', listenerMap[processId]);
                                } else return streamInstance[method](event, callback);
                            }
                        });

                        ['off', 'removeListener'].forEach(method => {
                            mutatedStream[method] = (event, callback) => {
                                if (event === 'change') {
                                    const processIdList = callback.prototype?.__cloneMongodbListener;

                                    if (processIdList) {
                                        processIdList.forEach(processId => {
                                            streamInstance[method](event, listenerMap[processId]);
                                            if (listenerMap[processId]) delete listenerMap[processId];
                                        });
                                        delete callback.prototype.__cloneMongodbListener;
                                    }
                                } else streamInstance[method](event, method);
                            }
                        });

                        return new Proxy({}, {
                            get(_, n) {
                                if (mutatedStream[n]) return mutatedStream[n];
                                if (typeof streamInstance[n] === 'function')
                                    return streamInstance[n].bind(streamInstance);
                                return streamInstance[n];
                            },
                            set(_, n, v) {
                                if (mutatedStream[n]) mutatedStream[n] = v;
                                else streamInstance[n] = v;
                                return true;
                            }
                        });
                    }

                    thisCol.aggregate = function () {
                        const [pipeline, options] = [...arguments];
                        const [sample, match] = pipeline,
                            size = sample?.$sample?.size,
                            filter = tipOff(match?.$match),
                            willRandomize = Number.isInteger(size) && size > 0 && random;

                        const aggregateInstance = colInstance.aggregate(
                            pipeline.map(v => {
                                if (v?.$match)
                                    return {
                                        ...v,
                                        $match: tipOff(v.$match)
                                    };
                                return v;
                            }),
                            options
                        );
                        const prevToArray = aggregateInstance.toArray.bind(aggregateInstance);

                        aggregateInstance.toArray = async () => {
                            return cleanUpResult(await prevToArray());
                        }

                        let randomPromise = async () => {
                            const [[smallDoc, bigDoc]] = await Promise.all([
                                Promise.all(['asc', 'desc'].map(dir =>
                                    colInstance.find({ ...filter }, options).sort(RANDOMIZER_FIELD, dir).limit(1).toArray()
                                )),
                                Promise.all(['asc', 'desc'].map(dir =>
                                    notifyIndex ?
                                        checkIndex(colInstance.find(filter).sort(RANDOMIZER_FIELD, dir).limit(1), indexNotice)
                                        : Promise.resolve()
                                ))
                            ]);
                            const [min, max] = [
                                smallDoc[0]?.[RANDOMIZER_FIELD],
                                bigDoc[0]?.[RANDOMIZER_FIELD]
                            ].map(v => v && v * 1);

                            if (isNaN(min) || isNaN(max)) {
                                return [];
                            } else if (min === max) {
                                return cleanUpResult(smallDoc);
                            } else {
                                const sizing = size + 0,
                                    spacing = (max - min) / sizing,
                                    randomOffset = [];
                                let k = min;

                                Array(sizing).fill().forEach(() => {
                                    randomOffset.push(getRandomNumber(k += spacing, k));
                                });

                                const offsetDoc = await Promise.all(randomOffset.map(offset =>
                                    colInstance.find({
                                        ...filter,
                                        [RANDOMIZER_FIELD]: { $gte: offset }
                                    }, options).sort(RANDOMIZER_FIELD, 'asc').limit(RANDOMIZE_CHUNK_SIZE).toArray()
                                ));
                                const result = shuffleArray(
                                    offsetDoc.flat().filter((v, i, a) => a.findIndex(k => CompareBson.equal(k._id, v._id)) === i)
                                );

                                if (result.length >= size) {
                                    return cleanUpResult(result.slice(0, size));
                                } else {
                                    const edgesDoc = await Promise.all(['asc', 'desc'].map(dir =>
                                        colInstance.find({ ...filter }, options).sort(RANDOMIZER_FIELD, dir).limit(Math.ceil(size / 2)).toArray()
                                    ));
                                    const finalResult = [
                                        ...result,
                                        ...shuffleArray(
                                            edgesDoc.flat().filter((v, i, a) => a.findIndex(k => CompareBson.equal(k._id, v._id)) === i)
                                        )
                                    ].filter((v, i, a) => a.findIndex(k => CompareBson.equal(k._id, v._id)) === i);

                                    return cleanUpResult(finalResult.slice(0, size));
                                }
                            }
                        };

                        return new Proxy({}, {
                            get(_, n) {
                                if (n === 'toArray' && willRandomize)
                                    return randomPromise;
                                if (typeof aggregateInstance[n] === 'function')
                                    return aggregateInstance[n].bind(aggregateInstance);
                                return aggregateInstance[n];
                            },
                            set(_, n, v) {
                                if (n === 'toArray' && willRandomize) {
                                    randomPromise = v;
                                } else aggregateInstance[n] = v;
                                return true;
                            }
                        });
                    }
                }
            });
        });

        return new Proxy({}, {
            get: (_, n) => {
                if (thisCol[n]) return thisCol[n];
                if (typeof colInstance[n] === 'function')
                    return colInstance[n].bind(colInstance);
                return colInstance[n];
            },
            set: (_, n, v) => {
                if (thisCol[n]) thisCol[n] = v;
                else colInstance[n] = v;
                return true;
            }
        });
    }

    return new Proxy({}, {
        get(_, n) {
            if (n === 'collection') return collectionX;
            if (typeof dbInstance[n] === 'function')
                return dbInstance[n].bind(dbInstance);
            return dbInstance[n];
        },
        set(_, n, v) {
            if (n === 'collection') collectionX = v;
            else dbInstance[n] = v;
            return true;
        }
    });
}

/**
 * checks if an index exists for a given query
 * @param {import("mongodb").FindCursor} queryRef
 */
const checkIndex = async (queryRef, indexNotice) => {
    if (indexNotice === 'off' || !indexNotice) return;
    const explanation = await queryRef.explain('queryPlanner');
    const { winningPlan, parsedQuery } = explanation?.queryPlanner || {};
    const isEmptyQuery = !Object.keys(parsedQuery || {}).length;
    const isGeoIndex = (obj) => ['GEO_NEAR_2DSPHERE'].includes(obj?.stage) &&
        !!obj.indexName;
    const isTextIndex = obj => obj?.stage === 'TEXT_MATCH' &&
        !!obj.indexName;

    // check plain _id index
    if (winningPlan?.stage === 'IDHACK') return;

    // check geo index
    if (
        isGeoIndex(winningPlan) ||
        (winningPlan?.stage === 'LIMIT' && isGeoIndex(winningPlan.inputStage))
    ) return;

    // check text index
    if (
        isTextIndex(winningPlan) ||
        (winningPlan?.stage === 'LIMIT' && isTextIndex(winningPlan.inputStage))
    ) return;

    const isFetchedIndex = obj =>
        obj?.stage === 'FETCH' &&
        !obj.filter &&
        (obj = obj.inputStage) &&
        obj.stage === 'IXSCAN' &&
        !!obj.indexName;

    // check direct fetch index
    if (isFetchedIndex(winningPlan)) return;
    if (
        winningPlan?.stage === 'LIMIT' &&
        !winningPlan.filter &&
        isFetchedIndex(winningPlan.inputStage)
    ) return;

    // check empty query index
    if (isEmptyQuery) {
        const isEmptyInputStage = obj =>
            obj?.stage === 'COLLSCAN' &&
            obj.direction &&
            Object.keys(obj).length === 2;

        if (
            isEmptyInputStage(winningPlan)
            || (
                winningPlan?.stage === 'LIMIT' &&
                !winningPlan.filter &&
                isEmptyInputStage(winningPlan.inputStage)
            )
        ) return;
    }

    if (typeof indexNotice === 'function') {
        indexNotice(explanation?.command);
        return;
    }
    const errMessage = 'cannot perform an index scan for mongodb query with command:';
    if (indexNotice === 'error') {
        throw `${errMessage} ${JSON.stringify(explanation?.command)}`;
    } else console.warn(errMessage, explanation?.command);
};

const shuffleArray = (n) => {
    const array = [...n];
    let currentIndex = array.length, randomIndex;

    while (currentIndex != 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }

    return array;
}

const getRandomNumber = (max = 70, min = 0) => {
    return ((max - min) * Math.random()) + min;
}

const serializeSearch = t => transformPunctuation(t.trim());

const buildInterception = async (doc, { fulltext, random, overhead, tokenizer }) => {
    if (overhead) return doc;
    if (!isRawObject(doc)) return doc;
    const newDoc = { ...doc };

    if (fulltext) {
        fulltext = (Array.isArray(fulltext) ? fulltext : [fulltext]);
        await Promise.all(fulltext.map(async field => {
            const t = doc[field];

            if (
                typeof t === 'string' &&
                t.trim() &&
                !doc[`${FULLTEXT_ARRAY_PREFIX}${field}`]
            ) {
                const thisToken = typeof t === 'string' && await tokenizer?.(t);
                newDoc[`${FULLTEXT_ARRAY_PREFIX}${field}`] = await getFulltextArray(tokenizer ? thisToken : t);
            }
        }));
    }
    if (random && !doc[RANDOMIZER_FIELD])
        newDoc[RANDOMIZER_FIELD] = Math.random();

    return newDoc;
};

const isRawObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export const getFulltextArray = async (t) => {
    if (!t?.trim?.()) return [];
    const textSplits = chunkifyText(t);

    // to avoid freezing the main thread with large text we run in background thread
    const chunks = textSplits.length > 1 ? await Promise.all(textSplits.map(text =>
        runBackgroundThread(`${__dirnamePath}/worker.js`, { text })
    )) : textSplits.map(text => ({ indexes: generateFulltextIndex(text) }));

    return [
        ...new Set(chunks.map(v => v.indexes).flat())
    ];
};

const runBackgroundThread = (script, args) => new Promise(resolve => {
    const worker = new Worker(script);
    worker.on('message', out => {
        resolve(out);
        worker.terminate();
    });
    worker.postMessage(args);
});

const chunkSize = 9 * 300; // max words
const chunkBreakPoint = 20000; // max chars

const chunkifyText = (t = '') => {
    t = t.split(' ');
    let out = [[]],
        wordCount = 0,
        wordSize = 0;

    for (let i = 0; i < t.length; i++) {
        const e = t[i];
        wordSize += e.length;

        if (
            (++wordCount <= chunkSize && wordSize < chunkBreakPoint) ||
            (!out[out.length - 1].length)
        ) {
            out[out.length - 1].push(e);
        } else {
            out.push([e]);
            wordSize = e.length;
            wordCount = 1;
        }
    }

    const result = [];

    out.forEach(e => {
        if (e.length) {
            if (e[0].length > chunkBreakPoint) {
                Array(Math.ceil(e[0].length / chunkBreakPoint))
                    .fill().forEach((_, i) => {
                        result.push(e[0].substring(i * chunkBreakPoint, (i + 1) * chunkBreakPoint));
                    });
            } else result.push(e.join(' '));
        }
    });

    return result;
};

const CompareBson = {
    equal: (doc, q, explicit) => {
        doc = downcastBSON(doc);
        q = downcastBSON(q);

        if (
            isBasicBSON(q) ||
            isBasicBSON(doc)
        ) {
            return sameInstance(doc, q) &&
                JSON.stringify(doc) === JSON.stringify(q);
        }

        if (q instanceof RegExp) {
            return sameInstance(doc, q) ?
                (doc.source === q.source && doc.flags === q.flags) :
                (explicit && typeof doc === 'string' && q.test(doc));
        }
        return JSON.stringify(doc) === JSON.stringify(q)
    }
};

const sameInstance = (var1, var2) => {
    try {
        return var1.constructor === var2.constructor &&
            Object.getPrototypeOf(var1) === Object.getPrototypeOf(var2)
    } catch (_) {
        return false;
    }
};

const downcastBSON = d => {
    if (d instanceof BSONRegExp)
        return new RegExp(d.pattern, d.options);
    if (
        [
            Long,
            Double,
            Int32,
            Decimal128
        ].some(v => d instanceof v)
    ) return d * 1;
    return d;
};

const isBasicBSON = d =>
    [
        Code,
        ObjectId,
        Binary,
        MaxKey,
        MinKey,
        UUID,
        Timestamp,
        BSONSymbol
    ].some(v => d instanceof v);