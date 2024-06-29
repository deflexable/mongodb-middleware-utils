import { MongoClient, MongoClientOptions } from 'mongodb';

interface MongoDbInterception {
    /**
     * true if you want to create a randomer field `__rdz`
     */
    random?: boolean;
    fulltext?: string[] | string;
    /**
     * true if you want to create `fulltext array field` and `randomizer field` in the background after data has been successfully written instead of intercepting the write operation.
     * 
     * This basically listen for data changes in the background.
     * @default false
     */
    overhead?: boolean;
    /**
     * set this to true if you want to avoid write failing due to exceeding the 16MB document limit set by mongodb
     * 
     * this silently stop adding searchable items to the array when this limit is reached
     * 
     * only works when `overhead` is set to true
     * @default
     * false
     */
    safeOverhead?: boolean;
}

interface InterceptedCollection {
    /**
     * @param collectionName the name of the collection you want to intercept
     */
    [collectionName: string]: MongoDbInterception;
}

interface InterceptionMap {
    /**
     * @param dbName the name of the database you want to intercept 
     */
    [dbName: string]: InterceptedCollection;
}

interface MongoClientHackConfig {
    /**
     * map out the collections you want to intercept
     */
    map: InterceptionMap;
    url?: string;
    options?: MongoClientOptions;
}

/**
 * initialize MongoClientHack Instance
 * 
 *   ```js
 *   import { MongoClientHack } from "mongodb-middleware-utils";
 *   
 *   // using MongoClientHack instance
 *   const mongoServer = new MongoClientHack({
 *       map: {
 *           'my_database_name': { // name of the database you want to intercept
 *               'my_collection_name': { // name of collection you want to intercept
 *                  random: true,
 *                  fulltext: ['name', 'des']
 *               }
 *           },
 *           'another_database_name': {
 *               'another_collection_name': {
 *                  random: true,
 *                  fulltext: ['name', 'des']
 *               }
 *           },
 *           // you can have as many map as needed
 *           ...otherMapping
 *       },
 *       url: 'mongodb://127.0.0.1:27017',
 *       options: {
 *           useUnifiedTopology: true,
 *           ...otherProps
 *       }
 *   });
```
 */
export class MongoClientHack extends MongoClient {
    constructor(config: MongoClientHackConfig);
}

/**
 * intercept MongoClient Instance
 * 
 * ```js
 *   import { proxyClient } from "mongodb-middleware-utils";
 * 
 *   const mongoServer = new MongoClient('mongodb://127.0.0.1:27017');
 *   
 *   proxyClient({
 *       'my_database_name': { // name of the database you want to intercept
 *           'my_collection_name': { // name of collection you want to intercept
 *              random: true,
 *              fulltext: ['name', 'des']
 *           }
 *       },
 *       'another_database_name': {
 *           'another_collection_name': {
 *              random: true,
 *              fulltext: ['name', 'des']
 *           }
 *       },
 *       // you can have as many map as needed
 *       ...otherMapping
 *   })(mongoServer);
 *   
 *   // connect
 *   mongoServer.connect();
 * ```
 */
export function proxyClient(map: InterceptionMap): (client: MongoClient) => void;
export function getFulltextArray(text: string): Promise<string[]>;

export const FULLTEXT_ARRAY_PREFIX: '__fta_';
export const RANDOMIZER_FIELD: '__rdz';