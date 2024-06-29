import { MongoClient } from 'mongodb';
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
    constructor({ map, url, options }) {
        super(url, options);
        this.interceptMap = map;
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
    client.__intercepted = true;
}

export const overheadConfig = (dbRef, interceptMap) => {
    Object.entries(interceptMap).forEach(([dbName, colObj]) => {

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
                                const indexes = await Promise.all(expectingText.map(async k =>
                                    [k, await getFulltextArray(thisData[k])]
                                ));
                                const limitedIndexes = indexes.map(([k]) => [k, new Set([])]);
                                let shouldBreak, sizer = 0;

                                for (let i = 0; i < indexes.length; i++) {
                                    if (shouldBreak) break;
                                    for (let x = 0; x < indexes[i][1].length; x++) {
                                        const element = indexes[i][1][x];

                                        if (!(shouldBreak = (sizer += (element.length + 4)) >= freeBytes)) {
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
                            const indexes = await Promise.all(expectingText.map(async k =>
                                [`${FULLTEXT_ARRAY_PREFIX}${k}`, await getFulltextArray(thisData[k])]
                            ));

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

const interceptDB = (dbRef, interceptMap) => function () {
    const dbInstance = dbRef(...[...arguments]),
        [thisDbName] = [...arguments];

    let collectionX = function () {
        const thisColArgs = [...arguments],
            colInstance = dbInstance.collection(...thisColArgs),
            // interception mappings
            thisCol = {},
            thisColName = thisColArgs[0];

        Object.entries(interceptMap).forEach(([dbName, colObj]) => {

            Object.entries(colObj).forEach(([colName, value]) => {
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

                    const cleanUpResult = res => {
                        let d = res;

                        if (Buffer.isBuffer(d)) d = JSON.parse(Buffer.from(d).toString('utf-8'));
                        if (!d) return Buffer.isBuffer(res) ? res : d;

                        let hits = (Array.isArray(d) ? d : [d]).map(doc => {
                            const n = { ...doc };

                            Object.keys(doc).forEach(k => {
                                if (
                                    k.startsWith(FULLTEXT_ARRAY_PREFIX) ||
                                    k === RANDOMIZER_FIELD
                                ) delete n[k];
                            });
                            return n;
                        });
                        hits = Array.isArray(d) ? hits : hits[0];

                        return Buffer.isBuffer(res) ? Buffer.from(JSON.stringify(hits), 'utf8') : hits;
                    }

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

                            return (await colInstance[op](
                                tipOff(a[0]),
                                await buildUpdateInterception(a[1]),
                                a[2]
                            ));
                        };
                    });

                    thisCol.replaceOne = async function () {
                        return await colInstance.replaceOne(
                            tipOff([...arguments][0]),
                            await buildInterception([...arguments][1], value),
                            [...arguments][2]
                        );
                    };

                    thisCol.bulkWrite = async function () {
                        let [tip, ...rest] = [...arguments];

                        return await colInstance.bulkWrite(
                            await Promise.all(tip.map(async v => {
                                const b = {};
                                await Promise.all(Object.entries(v).map(async ([key, obj]) => {

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
                        let [tip, ...rest] = [...arguments];
                        const findInstance = colInstance.find(tipOff(tip), ...rest),
                            prevToArray = findInstance.toArray.bind(findInstance);

                        findInstance.toArray = async () => {
                            return cleanUpResult(await prevToArray());
                        }
                        return findInstance;
                    }

                    thisCol.findOne = async function () {
                        let [tip, ...rest] = [...arguments];
                        const d = await colInstance.findOne(tipOff(tip), ...rest);
                        return cleanUpResult(d);
                    };

                    thisCol.watch = function () {
                        const [pipeline, ...rest] = [...arguments];
                        const streamInstance = colInstance.watch(Array.isArray(pipeline) ? pipeline.map(tipOff) : tipOff(pipeline), ...rest),
                            mutatedStream = {};
                        let listenerIte = 0,
                            listenerMap = {};

                        ['on', 'once', 'prependListener', 'addListener', 'prependOnceListener'].forEach(method => {
                            mutatedStream[method] = (event, callback) => {

                                if (event === 'change') {
                                    const processId = `${++listenerIte}`;
                                    listenerMap[processId] = s => {
                                        const h = Buffer.isBuffer(s) ? JSON.parse(Buffer.from(s).toString('utf-8')) : s;
                                        if (h.fullDocument)
                                            h.fullDocument = cleanUpResult(h.fullDocument);
                                        if (h.fullDocumentBeforeChange)
                                            h.fullDocumentBeforeChange = cleanUpResult(h.fullDocumentBeforeChange);
                                        if (h.updateDescription?.updatedFields)
                                            h.updateDescription.updatedFields = cleanUpResult(h.updateDescription.updatedFields)

                                        callback?.(Buffer.isBuffer(s) ? Buffer.from(JSON.stringify(h), 'utf8') : h);
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
                            }
                        });
                    }

                    thisCol.aggregate = function () {
                        const [pipeline, options] = [...arguments];
                        const [sample, match] = pipeline,
                            size = sample?.$sample?.size,
                            filter = tipOff(match?.$match),
                            willRandomize = (Number.isInteger(size) && size > 0 && random);

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
                        ),
                            prevToArray = aggregateInstance.toArray.bind(aggregateInstance);

                        aggregateInstance.toArray = async () => {
                            return cleanUpResult(await prevToArray());
                        }

                        let randomPromise = async () => {
                            const [smallDoc, bigDoc] = await Promise.all(['asc', 'desc'].map(dir =>
                                colInstance.find({ ...filter }).sort(RANDOMIZER_FIELD, dir).limit(1).toArray()
                            ));
                            const [min, max] = [
                                smallDoc[0]?.[RANDOMIZER_FIELD],
                                bigDoc[0]?.[RANDOMIZER_FIELD]
                            ];

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
                                        [`${RANDOMIZER_FIELD}`]: { $gte: offset }
                                    }).sort(RANDOMIZER_FIELD, 'asc').limit(RANDOMIZE_CHUNK_SIZE).toArray()
                                ));
                                const result = shuffleArray(
                                    offsetDoc.flat().filter((v, i, a) => a.findIndex(k => k._id === v._id) === i)
                                );

                                if (result.length >= size) {
                                    return cleanUpResult(result.slice(0, size));
                                } else {
                                    const edgesDoc = await Promise.all(['asc', 'desc'].map(dir =>
                                        colInstance.find({ ...filter }).sort(RANDOMIZER_FIELD, dir).limit(Math.ceil(size / 2)).toArray()
                                    ));
                                    const finalResult = [
                                        ...result,
                                        ...shuffleArray(
                                            edgesDoc.flat().filter((v, i, a) => a.findIndex(k => k._id === v._id) === i)
                                        )
                                    ].filter((v, i, a) => a.findIndex(k => k._id === v._id) === i);

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
        }
    });
}

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

const buildInterception = async (doc, { fulltext, random, overhead }) => {
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
                newDoc[`${FULLTEXT_ARRAY_PREFIX}${field}`] = await getFulltextArray(t);
            }
        }));
    }
    if (random && !doc[RANDOMIZER_FIELD])
        newDoc[RANDOMIZER_FIELD] = Math.random();

    return newDoc;
}

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
}

const runBackgroundThread = (script, args) => new Promise(resolve => {
    const worker = new Worker(script);
    worker.on('message', out => {
        resolve(out);
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
}