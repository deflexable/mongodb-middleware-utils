import { MongoClient } from 'mongodb';
import { Binary, BSONRegExp, BSONSymbol, Code, Decimal128, Double, Int32, Long, MaxKey, MinKey, ObjectId, Timestamp, UUID } from 'mongodb/lib/bson';
import { transformPunctuation } from './peripherals';
import { generateFulltextIndex } from './worker';
import { addTask } from './thread';

const one_mb = 1024 * 1024;

export const FULLTEXT_ARRAY_PREFIX = '__fta_';
export const RANDOMIZER_FIELD = '__rdz';
const RANDOMIZE_CHUNK_SIZE = 3;
const MAX_DOC_SIZE = one_mb * 15;

export class MongoClientHack extends MongoClient {
    constructor({ map, url, tokenizer, indexNotice, options }) {
        super(url, options);
        this.interceptMap = { map, tokenizer, indexNotice };
        this.overhead = overheadConfig(super.db.bind(this), this.interceptMap);
    }

    get db() {
        return interceptDB(super.db.bind(this), this.interceptMap);
    }
    __intercepted = true;
};

export const proxyClient = (interceptMap) =>
    (client) => {
        if (client.__intercepted) throw new Error(`this MongoClient instance was previously intercepted`);
        const listener = overheadConfig(client.db.bind(client), interceptMap);

        const originalDbInstance = client.db.bind(client);
        client.db = interceptDB(originalDbInstance, interceptMap);
        client.interceptMap = interceptMap;
        client.__intercepted = true;

        client.overhead = listener;

        return listener;
    }

const ListeningFulltext = {};

const overheadConfig = (dbRef, interceptMap) => {
    const { map, tokenizer, indexNotice } = interceptMap;

    if (tokenizer !== undefined && typeof tokenizer !== 'function')
        throw new Error(`expected a function for field:"tokenizer" but got ${tokenizer}`);

    if (
        indexNotice !== undefined &&
        typeof indexNotice !== 'function' &&
        !['warn', 'error', 'off'].some(v => indexNotice === v)
    ) throw new Error(`expected either a function or any of 'warn', 'error', 'off' for field:"indexNotice" but got ${indexNotice}`);

    const listeners = [];

    const PendingOverheapOps = {};

    Object.entries(map || {}).forEach(([dbName, colObj]) => {

        Object.entries(colObj).forEach(([colName, value]) => {
            const logRef = `dbName(${dbName}), collectionName(${colName})`;
            const { fulltext, random, safeOverhead, overhead, isolateFullText } = value || {};

            if (fulltext) {
                if (Array.isArray(fulltext)) {
                    if (fulltext.some(v => typeof v !== 'string' || v.includes('.') || !v.trim())) {
                        throw new Error(`invalid interception value in ${logRef}, 'fulltext' array must contain a non empty string without "." value but got ${JSON.stringify(fulltext)}`);
                    } else if (!fulltext.length) {
                        throw new Error(`invalid interception value in ${logRef}, 'fulltext' array must not be empty`);
                    } else if (fulltext.filter((v, i, a) => a.indexOf(v) === i).length !== fulltext.length) {
                        throw new Error(`invalid interception value in ${logRef}, 'fulltext' array must not contain duplicate value but got ${fulltext}`);
                    }
                } else if (typeof fulltext !== 'string' || fulltext.includes('.')) {
                    throw new Error(`invalid interception value in ${logRef}, 'fulltext' must either be a string without "." or array but got ${fulltext}`);
                } else if (!fulltext.trim()) {
                    throw new Error(`invalid interception value in ${logRef}, 'fulltext' must not be empty`);
                }
            } else if (isolateFullText)
                throw new Error(`isolateFullText requires 'fulltext' to be defined`);

            if (random !== undefined && typeof random !== 'boolean')
                throw new Error(`invalid interception value in ${logRef}, random should be a boolean value but got ${random}`);
            if (isolateFullText !== undefined && typeof isolateFullText !== 'boolean')
                throw new Error(`invalid interception value in ${logRef}, isolateFullText should be a boolean value but got ${isolateFullText}`);

            if (safeOverhead && !overhead)
                throw new Error(`"safeOverhead" should only be true when "overhead" is true`);

            if (overhead && (fulltext || random)) {
                const startOverhead = () => {
                    if (ListeningFulltext[logRef]) {
                        console.warn(`multiple overhead task of ${logRef} were initiated, this may cause data corruption or inconsistency`);
                    }
                    ListeningFulltext[logRef] = true;

                    const textArr = fulltext ? Array.isArray(fulltext) ? fulltext : [fulltext] : [];

                    const listenOverhead = (resumeAfter) => {
                        const getFtColRef = () => dbRef(dbName).collection(FULLTEXT_ARRAY_PREFIX.concat(colName));
                        const colRef = dbRef(dbName).collection(colName);
                        const stream = colRef.watch(undefined, { resumeAfter });

                        console.log('listening overhead:', colName);

                        stream.on('resumeTokenChanged', (token) => {
                            resumeAfter = token;
                        });

                        let closure = null;

                        stream.on('error', async () => {
                            await stream.close();
                            setTimeout(() => {
                                if (closure === null)
                                    closure = listenOverhead(resumeAfter);
                            }, 7000);
                        });

                        stream.on('change', async ({ operationType, fullDocument, updateDescription, documentKey }) => {
                            const { _id } = documentKey;
                            const taskKey = `${dbName},${colName},${_id}`;

                            const prevPromise = PendingOverheapOps[taskKey];

                            const thisPromise =
                                (async () => {
                                    try {
                                        if (prevPromise)
                                            await prevPromise.catch(() => null);

                                        if (operationType === 'delete') {
                                            if (isolateFullText) return getFtColRef().deleteOne({ _id });
                                            return;
                                        }

                                        const thisData = fullDocument || await colRef.findOne({ _id });
                                        if (!thisData) return;
                                        const promises = [];

                                        const randomData =
                                            (!random || thisData[RANDOMIZER_FIELD])
                                                ? undefined
                                                : { [RANDOMIZER_FIELD]: Math.random() };

                                        const expectingText =
                                            fulltext ?
                                                ['insert', 'replace'].includes(operationType)
                                                    ? textArr.filter(v => thisData[v])
                                                    : Object.keys(updateDescription?.updatedFields || {})
                                                        .filter(v => textArr.includes(v))
                                                : [];

                                        const unsetFields =
                                            operationType === 'replace'
                                                ? textArr.filter(v => !thisData[v])
                                                : (updateDescription?.removedFields || [])
                                                    .filter(v => textArr.includes(v));

                                        const unsetData =
                                            unsetFields.length
                                                ? {
                                                    $unset:
                                                        Object.fromEntries(
                                                            unsetFields.map(v =>
                                                                [`${FULLTEXT_ARRAY_PREFIX}${v}`, true]
                                                            )
                                                        )
                                                }
                                                : undefined;

                                        const getFtIndex = () =>
                                            Promise.all(
                                                expectingText.map(async k => {
                                                    const thisText = thisData[k];
                                                    const thisToken = typeof thisText === 'string' && (await tokenizer?.(thisText));
                                                    return [
                                                        `${FULLTEXT_ARRAY_PREFIX}${k}`,
                                                        await getFulltextArray(tokenizer ? thisToken : thisText)
                                                    ];
                                                })
                                            );

                                        if (
                                            expectingText.length ||
                                            (random && !thisData[RANDOMIZER_FIELD])
                                        ) {
                                            console.log('overhead working');
                                            if (safeOverhead) {
                                                const freeBytes =
                                                    MAX_DOC_SIZE - JSON.stringify({
                                                        ...thisData,
                                                        ...Object.fromEntries(expectingText.map(k => [k]))
                                                    }).length;
                                                if (freeBytes > 0) {
                                                    const indexes = await getFtIndex();
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

                                                    const ftData =
                                                        limitedIndexes.length
                                                            ? Object.fromEntries(
                                                                limitedIndexes
                                                                    .map(([k, v]) => [k, [...v]])
                                                                    .filter(v => v[1].length)
                                                            )
                                                            : undefined;

                                                    if (randomData || (!isolateFullText && ftData))
                                                        promises.push(
                                                            colRef.updateOne({ _id }, {
                                                                ...unsetData,
                                                                $set: {
                                                                    ...isolateFullText ? undefined : ftData,
                                                                    ...randomData
                                                                }
                                                            })
                                                        );

                                                    if (randomData || (isolateFullText && ftData))
                                                        promises.push(
                                                            getFtColRef().updateOne({ _id }, {
                                                                ...unsetData,
                                                                $set: {
                                                                    ...isolateFullText ? ftData : undefined,
                                                                    ...randomData
                                                                }
                                                            })
                                                        );
                                                } else if (randomData) {
                                                    promises.push(colRef.updateOne({ _id }, { ...unsetData, $set: randomData }));
                                                    if (isolateFullText)
                                                        promises.push(getFtColRef().updateOne({ _id }, { ...unsetData, $set: randomData }));
                                                }
                                            } else {
                                                const indexes = await getFtIndex();
                                                const ftData = indexes.length ? Object.fromEntries(indexes) : undefined;

                                                if (randomData || (!isolateFullText && ftData))
                                                    promises.push(
                                                        colRef.updateOne({ _id }, {
                                                            ...unsetData,
                                                            $set: {
                                                                ...isolateFullText ? undefined : ftData,
                                                                ...randomData
                                                            }
                                                        })
                                                    );

                                                if (randomData || (isolateFullText && ftData))
                                                    promises.push(
                                                        getFtColRef().updateOne({ _id }, {
                                                            ...unsetData,
                                                            $set: {
                                                                ...isolateFullText ? ftData : undefined,
                                                                ...randomData
                                                            }
                                                        })
                                                    );
                                            }
                                        } else if (unsetData) {
                                            promises.push(
                                                isolateFullText
                                                    ? getFtColRef().updateOne({ _id }, unsetData)
                                                    : colRef.updateOne({ _id }, unsetData)
                                            );
                                        }

                                        if (promises.length) await Promise.all(promises);
                                    } catch (error) {
                                        console.error('overhead err:', error);
                                        throw error;
                                    }
                                })();

                            PendingOverheapOps[taskKey] = thisPromise;

                            thisPromise.finally(() => {
                                if (PendingOverheapOps[taskKey] === thisPromise)
                                    delete PendingOverheapOps[taskKey];
                            });

                            return thisPromise;
                        });

                        return () => {
                            const thisClosure = closure;
                            closure = undefined;

                            if (thisClosure === null) {
                                return stream.close();
                            } else if (typeof thisClosure === 'function') {
                                return thisClosure();
                            }
                        }
                    }

                    const stopper = listenOverhead();

                    return () => {
                        if (ListeningFulltext[logRef])
                            delete ListeningFulltext[logRef];

                        return stopper();
                    }
                }

                listeners.push([startOverhead]);
            }
        });
    });

    let hasStart;

    return {
        start: () => {
            if (hasStart) return;
            hasStart = true;
            listeners.forEach(v => {
                v[1] = v[0]();
            });
        },
        end: () => {
            if (!hasStart) return;
            hasStart = false;
            listeners.forEach(v => {
                if (v[1]) {
                    v[1]();
                    v[1] = undefined;
                }
            });
        }
    }
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

    const dbInstance = dbRef(...arguments);
    const thisDbName = arguments[0];

    let collectionX = function () {
        const thisColArgs = [...arguments];
        const colInstance = dbInstance.collection(...thisColArgs);
        // interception mappings
        const thisCol = {};
        const thisColName = thisColArgs[0];

        const schema = map?.[thisDbName]?.[thisColName];
        const value = { ...schema, tokenizer };

        if (value?.fulltext || value?.random || notifyIndex) {
            const { fulltext, random, isolateFullText, overhead } = value;
            const hasIsolation = isolateFullText && fulltext;
            const hasIsolationWrite = hasIsolation && !overhead;

            const ftColInstance =
                hasIsolation
                    ? dbInstance.collection(FULLTEXT_ARRAY_PREFIX.concat(thisColArgs[0]), thisColArgs[1])
                    : undefined;

            const tipOff = (tip) => {
                let hasSearch;

                if (tip?.$text?.$search && fulltext) {
                    const sf = tip.$text.$field || fulltext;
                    const searchField = Array.isArray(sf) ? sf : [sf];

                    if (searchField.some((v, i, a) => a.indexOf(v) !== i))
                        throw new Error(`$field must not contain duplicate values`);

                    if (!searchField.length)
                        throw new Error(`$field or $fulltext cannot be empty in query:${tip}`);

                    const searchFilter =
                        searchField.map(field => ({
                            [`${FULLTEXT_ARRAY_PREFIX}${field}`]: {
                                $in: [serializeSearch(tip?.$text?.$search)]
                            }
                        }));

                    tip = {
                        ...tip,
                        ...searchFilter.length > 1
                            ? {
                                $or: [
                                    ...tip?.$or || [],
                                    ...searchFilter
                                ]
                            } : searchFilter[0]
                    };
                    delete tip.$text;
                    hasSearch = true;
                }

                return { filter: tip, hasSearch };
            }

            const cleanUpResult = (res) => {
                (Array.isArray(res) ? res : [res])
                    .forEach(doc => {
                        if (!doc) return doc;

                        for (const field in doc) {
                            if (
                                field.startsWith(FULLTEXT_ARRAY_PREFIX) ||
                                field === RANDOMIZER_FIELD
                            ) delete doc[field];
                        }
                    });

                return res;
            };

            const injectWriteData = async (doc) => {
                const data1 = await buildInterception(doc, value);
                if (!hasIsolationWrite) return [data1];

                const data2 = { ...doc };

                if (data1[RANDOMIZER_FIELD])
                    data2[RANDOMIZER_FIELD] = data1[RANDOMIZER_FIELD];

                return [data2, data1];
            }

            const injectUpdateData = async (d) => {
                const res = [];

                if (isRawObject(d)) {
                    res[0] = { ...d };
                    if (hasIsolationWrite)
                        res[1] = {
                            ...d,
                            ...d.$setOnInsert ? undefined : {
                                $setOnInsert: {
                                    [RANDOMIZER_FIELD]: Math.random()
                                }
                            }
                        };

                    await Promise.all(
                        ['$set', '$setOnInsert'].map(async n => {
                            if (d[n]) {
                                (await injectWriteData(d[n]))
                                    .forEach((v, i) => {
                                        res[i][n] = v;
                                        if (n === '$set' && v[RANDOMIZER_FIELD])
                                            delete v[RANDOMIZER_FIELD];
                                    });
                            }
                        })
                    );

                    if (d.$unset) {
                        (Array.isArray(fulltext) ? fulltext : [fulltext]).forEach(v => {
                            const dex = hasIsolationWrite ? 1 : 0;
                            if (res[dex].$unset[v])
                                res[dex].$unset[`${FULLTEXT_ARRAY_PREFIX}${v}`] = true;
                        });
                    }
                }

                return res;
            }

            thisCol.insertOne = async function () {
                const results = await injectWriteData(arguments[0]);

                const mainPromise = colInstance.insertOne(results[0], arguments[1]);

                if (results.length === 2)
                    await ftColInstance.insertOne(results[1], arguments[1]);

                return mainPromise;
            };

            thisCol.insertMany = async function () {
                const results = await Promise.all(arguments[0].map(v => injectWriteData(v)));

                const mainPromise =
                    colInstance.insertMany(results.map(v => v[0]), arguments[1]);

                if (hasIsolationWrite)
                    await ftColInstance.insertMany(results.map(v => v[1]), arguments[1]);

                return mainPromise;
            };

            ['updateOne', 'updateMany'].forEach(op => {

                thisCol[op] = async function () {
                    const { filter: filterObj, hasSearch } = tipOff(arguments[0]);

                    if (notifyIndex)
                        await checkIndex(
                            ((hasSearch && hasIsolation) ? ftColInstance : colInstance)
                                .find(filterObj).limit(1),
                            indexNotice
                        );

                    const results = await injectUpdateData(arguments[1]);

                    const mainPromise =
                        colInstance[op](filterObj, results[0], arguments[2]);

                    if (results.length === 2)
                        await ftColInstance[op](filterObj, results[1], arguments[2]);

                    return mainPromise;
                };
            });

            thisCol.replaceOne = async function () {
                const { filter: filterObj, hasSearch } = tipOff(arguments[0]);

                if (notifyIndex)
                    await checkIndex(
                        ((hasSearch && hasIsolation) ? ftColInstance : colInstance)
                            .find(filterObj).limit(1),
                        indexNotice
                    );

                const result = await injectWriteData(arguments[1]);

                const mainPromise = colInstance.replaceOne(filterObj, result[0], arguments[2]);

                if (result.length === 2)
                    await ftColInstance.replaceOne(filterObj, result[1], arguments[2]);

                return mainPromise;
            };

            if (hasIsolationWrite)
                thisCol.deleteOne = async function () {
                    const mainPromise = colInstance.deleteOne(...arguments);

                    await ftColInstance.deleteOne(...arguments);

                    return mainPromise;
                };

            if (hasIsolationWrite)
                thisCol.deleteMany = async function () {
                    const mainPromise = colInstance.deleteMany(...arguments);

                    await ftColInstance.deleteMany(...arguments);

                    return mainPromise;
                };

            thisCol.bulkWrite = async function () {
                const results =
                    await Promise.all(arguments[0].map(async v => {
                        const b = [{}];

                        await Promise.all(Object.entries(v).map(async ([key, obj]) => {
                            const { filter, hasSearch } = tipOff(obj.filter);
                            const arrayFilters =
                                obj.arrayFilters
                                    ? obj.arrayFilters.map(v => tipOff(v).filter)
                                    : undefined;

                            if (key !== 'insertOne' && notifyIndex && !arrayFilters)
                                await checkIndex(
                                    ((hasSearch && hasIsolation) ? ftColInstance : colInstance)
                                        .find(filter).limit(1),
                                    indexNotice
                                );

                            const documentObj = obj.document ? await injectWriteData(obj.document) : undefined;
                            const replacementObj = obj.replacement ? await injectWriteData(obj.replacement) : undefined;
                            const updateObj = obj.update ? await injectUpdateData(obj.update) : undefined;

                            const o = {
                                ...obj,
                                ...obj.filter ? { filter } : {},
                                ...arrayFilters ? {} : { arrayFilters }
                            };

                            b[0][key] = {
                                ...o,
                                ...obj.document ? { document: documentObj[0] } : {},
                                ...obj.replacement ? { replacement: replacementObj[0] } : {},
                                ...obj.update ? { update: updateObj[0] } : {}
                            };

                            if (hasIsolationWrite) {
                                if (!b[1]) b[1] = {};
                                b[1][key] = {
                                    ...o,
                                    ...obj.document ? { document: documentObj[1] } : {},
                                    ...obj.replacement ? { replacement: replacementObj[1] } : {},
                                    ...obj.update ? { update: updateObj[1] } : {}
                                };
                            }
                        }));

                        return b;
                    }));

                const mainPromise = colInstance.bulkWrite(results.map(v => v[0]), arguments[1]);

                if (hasIsolationWrite)
                    await ftColInstance.bulkWrite(results.map(v => v[1]), arguments[1]);

                return mainPromise;
            }

            thisCol.find = function () {
                const { filter, hasSearch } = tipOff(arguments[0]);
                const findInstance =
                    ((hasSearch && hasIsolation) ? ftColInstance : colInstance)
                        .find(filter, arguments[1]);

                const prevToArray = findInstance.toArray.bind(findInstance);

                findInstance.toArray = async () => {
                    if (notifyIndex) await checkIndex(findInstance.clone().limit(1), indexNotice);

                    return cleanUpResult(await prevToArray());
                }

                return findInstance;
            }

            thisCol.findOne = async function () {
                let [tip, ...rest] = [...arguments];
                const { filter, hasSearch } = tipOff(tip);

                const colRef = ((hasSearch && hasIsolation) ? ftColInstance : colInstance);

                if (notifyIndex) await checkIndex(colRef.find(filter).limit(1), indexNotice);

                const d = await colRef.findOne(filter, ...rest);
                return cleanUpResult(d);
            };

            thisCol.watch = function () {
                const streamInstance = colInstance.watch(...arguments);
                const mutatedStream = {};
                const callbackMap = new Map();

                const onceMethods = new Set(['once', 'prependOnceListener']);

                const cleanListener = (callback, reg, method) => {
                    const registrations = callbackMap.get(callback);

                    if (registrations) {
                        const dex =
                            reg === undefined
                                ? registrations.length
                                    ? registrations.length - 1
                                    : -1
                                : registrations.findIndex(v => v === reg);

                        if (dex !== -1) {
                            if (method) streamInstance[method]('change', registrations[dex]);
                            registrations.splice(dex, 1);
                        }

                        if (!registrations.length) {
                            callbackMap.delete(callback);
                        }
                    }
                }

                ['on', 'once', 'prependListener', 'addListener', 'prependOnceListener'].forEach(method => {
                    mutatedStream[method] = (event, callback) => {

                        if (event === 'change') {
                            const injectCallback = s => {
                                if (onceMethods.has(method))
                                    cleanListener(callback, injectCallback);

                                const h = s;
                                if (h.fullDocument)
                                    h.fullDocument = cleanUpResult(h.fullDocument);
                                if (h.fullDocumentBeforeChange)
                                    h.fullDocumentBeforeChange = cleanUpResult(h.fullDocumentBeforeChange);
                                if (h.updateDescription?.updatedFields)
                                    h.updateDescription.updatedFields = cleanUpResult(h.updateDescription.updatedFields)

                                return callback?.(h);
                            }

                            if (callbackMap.has(callback)) {
                                callbackMap.get(callback).push(injectCallback);
                            } else callbackMap.set(callback, [injectCallback]);

                            streamInstance[method]('change', injectCallback);
                        } else streamInstance[method](event, callback);

                        return mutatedProxy;
                    }
                });

                ['off', 'removeListener'].forEach(method => {
                    mutatedStream[method] = (event, callback) => {
                        if (event === 'change') {
                            cleanListener(callback, undefined, method);
                        } else streamInstance[method](event, callback);
                        return mutatedProxy;
                    }
                });

                mutatedStream.removeAllListeners = (event) => {
                    streamInstance.removeAllListeners(event);

                    if (event === undefined || event === 'change') {
                        callbackMap.clear();
                    }

                    return mutatedProxy;
                }

                streamInstance.once('close', () => {
                    callbackMap.clear();
                });

                const mutatedProxy =
                    new Proxy({}, {
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

                return mutatedProxy;
            }

            thisCol.aggregate = function () {
                let filterObj = {};
                let hasSearch;

                const query =
                    arguments[0].map(v => {
                        if (v?.$match) {
                            const tip = tipOff(v.$match);
                            if (tip.hasSearch) hasSearch = true;
                            filterObj = { ...filterObj, ...tip.filter };

                            return {
                                ...v,
                                $match: tip.filter
                            };
                        }
                        return v;
                    });

                const colRef = ((hasSearch && hasIsolation) ? ftColInstance : colInstance);
                const options = arguments[1];
                const size = arguments[0]?.[0]?.$sample?.size;
                const willRandomize = Number.isInteger(size) && size > 0 && random;

                const aggregateInstance = colRef.aggregate(query, options);

                const prevToArray = aggregateInstance.toArray.bind(aggregateInstance);

                aggregateInstance.toArray = async () => {
                    if (willRandomize) return randomPromise();
                    return cleanUpResult(await prevToArray());
                }

                let randomPromise = async function () {
                    const [[smallDoc, bigDoc]] =
                        await Promise.all([
                            Promise.all(['asc', 'desc'].map(dir =>
                                colRef.find(filterObj, options).sort(RANDOMIZER_FIELD, dir).limit(1).toArray()
                            )),
                            Promise.all(['asc', 'desc'].map(dir =>
                                notifyIndex ?
                                    checkIndex(colRef.find(filterObj).sort(RANDOMIZER_FIELD, dir).limit(1), indexNotice)
                                    : Promise.resolve()
                            ))
                        ]);
                    const [min, max] = [
                        smallDoc[0]?.[RANDOMIZER_FIELD],
                        bigDoc[0]?.[RANDOMIZER_FIELD]
                    ].map(v => Math.max(Math.min(v && v * 1, 1), 0));

                    if (isNaN(min) || isNaN(max)) {
                        return [];
                    } else if (min === max) {
                        return cleanUpResult(smallDoc);
                    } else {
                        const sizing = size + 0,
                            spacing = (max - min) / sizing,
                            randomSections = [];

                        let sectionOffset = min;

                        Array(sizing).fill().forEach(() => {
                            randomSections.push(getRandomNumber(sectionOffset += spacing, sectionOffset));
                        });

                        const offsetDoc =
                            await Promise.all(
                                randomSections.map(offset =>
                                    colRef.find({
                                        ...filterObj,
                                        [RANDOMIZER_FIELD]: { $gte: offset }
                                    }, options).sort(RANDOMIZER_FIELD, 'asc').limit(RANDOMIZE_CHUNK_SIZE).toArray()
                                )
                            );

                        const removeDuplicates = (docs = []) =>
                            docs.filter((v, i, a) => a.findIndex(k => CompareBson.equal(k._id, v._id)) === i);

                        const result = shuffleArray(removeDuplicates(offsetDoc.flat()));

                        if (result.length >= size) {
                            return cleanUpResult(result.slice(0, size));
                        } else {
                            const edgesDoc =
                                await Promise.all(['asc', 'desc'].map(dir =>
                                    colRef.find(filterObj, options).sort(RANDOMIZER_FIELD, dir).limit(Math.ceil(size / 2)).toArray()
                                ));
                            const finalResult =
                                removeDuplicates([
                                    ...result,
                                    ...shuffleArray(removeDuplicates(edgesDoc.flat()))
                                ]);

                            return cleanUpResult(finalResult.slice(0, size));
                        }
                    }
                };

                return aggregateInstance;
            }
        }

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
};

/**
 * checks if an index exists for a given query
 * @param {import("mongodb").FindCursor} queryRef
 */
const checkIndex = async (queryRef, indexNotice) => {
    if (indexNotice === 'off' || !indexNotice) return;
    const explanation = await queryRef.explain('queryPlanner');
    const { winningPlan, parsedQuery } = explanation?.queryPlanner || {};
    const isEmptyQuery = !Object.keys(parsedQuery || {}).length;
    const isGeoIndex = (obj) =>
        ['GEO_NEAR_2DSPHERE'].includes(obj?.stage) &&
        !!obj.indexName;
    const isTextIndex = obj =>
        obj?.stage === 'TEXT_MATCH' &&
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

    if (winningPlan?.stage === 'EXPRESS_IXSCAN' && winningPlan?.indexName) return;

    if (
        winningPlan?.stage === 'EOF' &&
        winningPlan?.type === 'nonExistentNamespace'
    ) {
        const hasQuery =
            Object.entries(explanation?.command || {})
                .some(([k, v]) => {
                    if (!['find', 'limit', '$db'].includes(k)) {
                        if (k === 'filter') {
                            const nodes =
                                Object.keys(v || {})
                                    .filter(v => v !== '_id');

                            if (nodes.length) return true;
                        } else return true;
                    }
                });

        if (!hasQuery) return;
    }

    if (typeof indexNotice === 'function') {
        indexNotice(explanation);
        return;
    }

    const errMessage = 'cannot perform an index scan for mongodb query with command:';
    if (indexNotice === 'error') {
        throw new Error(`${errMessage} ${JSON.stringify(explanation?.command)}`);
    } else {
        console.warn(errMessage, explanation?.command);
    }
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
        await Promise.all(
            fulltext.map(async field => {
                const t = doc[field];

                if (
                    typeof t === 'string' &&
                    t.trim() &&
                    !doc[`${FULLTEXT_ARRAY_PREFIX}${field}`]
                ) {
                    const thisToken =
                        typeof t === 'string' &&
                        await tokenizer?.(t);

                    newDoc[`${FULLTEXT_ARRAY_PREFIX}${field}`] =
                        await getFulltextArray(tokenizer ? thisToken : t);
                }
            })
        );
    }
    if (random && !doc[RANDOMIZER_FIELD])
        newDoc[RANDOMIZER_FIELD] = Math.random();

    return newDoc;
};

const isRawObject = (o) =>
    o !== null &&
    typeof o === 'object' &&
    !Array.isArray(o);

export const getFulltextArray = async (t) => {
    if (!t?.trim?.()) return [];
    const textSplits = chunkifyText(t);

    // to avoid freezing the main thread with large text we run in background thread
    const chunks =
        textSplits.length > 1
            ? await Promise.all(textSplits.map(text => addTask({ text })))
            : textSplits.map(text => ({ indexes: generateFulltextIndex(text) }));

    const indexes = new Set();

    for (const chunk of chunks) {
        for (const token of chunk.indexes) {
            indexes.add(token);
        }
    }

    return [...indexes];
};

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