import { MongoClient, MongoClientOptions } from 'mongodb';

interface MongoDbInterception {
    random?: boolean;
    fulltext?: string[] | string;
}

interface InterceptionMap {
    [key: string]: MongoDbInterception;
}

interface MongoClientHackConfig {
    map: InterceptionMap;
    url?: string;
    options?: MongoClientOptions;
}

export class MongoClientHack extends MongoClient {
    constructor(config: MongoClientHackConfig);
}

export function proxyClient(map: InterceptionMap): (client: MongoClient) => void;
export function getFulltextArray(text: string): Promise<string[]>;