# mongodb-hack-middleware

mongodb-hack-middleware provides a comprehensive solution for enhancing MongoDB collections with full-text indexing capabilities and offers a convenient way to retrieve random documents. Whether you're building a search-intensive application or need a way to fetch diverse data for testing locally or on-premise, this streamlines these processes for MongoDB users using the [community version](https://www.mongodb.com/try/download/community)

## Key Advantages

- MongoDB [community version](https://www.mongodb.com/try/download/community) provides a text search feature but it operates on a word-by-word basis using the "or operator" and doesn't support searching word by prefixes. It also can't perform text search on a particular field. This limitation inspired the creation of this repository, offering an enhanced and versatile solution for text-based queries.

- Elevate your random document retrieval experience with our enhanced solution, addressing limitations found in MongoDB's $sample stage. Enjoy precise counts, elimination of duplicates documents, and providing a truly random and distinct set of documents.

## Installation

```sh
npm install mongodb-hack-middleware
```

or using yarn

```sh
yarn add mongodb-hack-middleware
```

## Usage

### initialize MongoClientHack or proxy MongoClient

```js
import { proxyClient, MongoClientHack } from "mongodb-hack-middleware";

// using MongoClientHack instance
const mongoServer = new MongoClientHack({
    map: {
        'examjoint::hack_test': { // your databaseName::collectionName
            random: true,
            fulltext: ['name', 'des']
        }
    },
    url: 'mongodb://127.0.0.1:27017',
    options: {
        useUnifiedTopology: true,
        ...otherProps
    }
});

// using MongoClient
const mongoServer = new MongoClient('mongodb://127.0.0.1:27017');

proxyClient({
    'examjoint::hack_test': { // your databaseName::collectionName
        random: true,
        fulltext: ['name', 'des']
    }
})(mongoServer);

// connect
mongoServer.connect();

const db = mongoServer.db('examjoint');

// insert document
await db.collection('hack_test').insertOne({
    _id: 'doc1',
    name: 'ademola onabanjo',
    date: Date.now(),
    des: 'Lorem ipsum dolor sit amet consectetur'
});

```

## searching text

```js
const nameOrDesFieldSearch = await db.collection().find({ $text: { $search: 'sit amet consec' } }).toArray();

// outputs: 
// [{
//     _id: 'doc1',
//     name: 'ademola onabanjo',
//     date: Date.now(),
//     des: 'Lorem ipsum dolor sit amet consectetur'
// }]
console.log('searchResult: ', nameOrDesFieldSearch);

// search single field

const nameFieldSearch = await db.collection().find({ $text: { $search: 'onaba', $field: 'name' } }).toArray();

// outputs: 
// [{
//     _id: 'doc1',
//     name: 'ademola onabanjo',
//     date: Date.now(),
//     des: 'Lorem ipsum dolor sit amet consectetur'
// }]
console.log('searchResult: ', nameFieldSearch);
```

## random query

```js
// make sure you followed this process when querying random document ($sample at the first pipeline and $match at the second one)
// or else it fallback to using the native caller
const searchRes = await db.collection('hack_test').aggregate([
    { $sample: { $size: 5 } }
    { $match: { } }
]).limit(1).toArray();
```

## Document transformation

### fulltext index

Some write operations are proxied to add an extra field value to the document for querying random document and searching text.
Some read operations are also proxied to remove redundant field value.
The following methods are proxied on the collection instance to transform the document

- `insertOne`
- `insertMany`
- `updateOne` ($set, $unset)
- `replaceOne`
- `bulkWrite`
- `find`
- `findOne`
- `watch`
- `aggregate`

### $text transformation

`{ $text: { $search: 'onaba', $field: 'des' } }` is transformed to `{ $or: [...your-$Or-Props, { __fta_des: { $in: ['onaba'] } }] }`
while `{ $text: { $search: 'onaba', $field: ['name', 'des'] } }` is transformed to `{ $or: [...your-$Or-Props, { __fta_name: { $in: ['onaba'] } }, { __fta_des: { $in: ['onaba'] } }] }`

## Limitations

- As the maximum size of a document in mongodb is 16mb, Avoid saving more than 37,000 bytes of characters for fulltext field. this 37,000 chars can produce approximately 301,391 strings in array with 11mb in size.

## Cons