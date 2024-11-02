# mongodb-middleware-utils

mongodb-middleware-utils provides a work around solution for enhancing MongoDB collections with full-text indexing capabilities and offers a convenient way to retrieve random documents. Whether you're building a search-intensive application or need a way to fetch diverse data for testing locally or on-premise, this streamlines these processes for MongoDB users using the [community version](https://www.mongodb.com/try/download/community).

## Key Advantages

- MongoDB [community version](https://www.mongodb.com/try/download/community) provides a text search feature but it operates on a word-by-word basis using the "or operator" and doesn't support searching word by prefixes. It also can't perform text search on a particular field. This limitation inspired the creation of this repository, offering an enhanced and versatile solution for text-based queries.

- Elevate your random document retrieval experience with our enhanced solution, addressing limitations found in MongoDB's $sample stage. Enjoy precise counts, elimination of duplicates documents, and providing a truly random and distinct set of documents.

- Zero dependency

## Installation

```sh
npm install mongodb-middleware-utils
```

or using yarn

```sh
yarn add mongodb-middleware-utils
```

## Usage

### initialize MongoClientHack or proxy MongoClient

```js
import { proxyClient, MongoClientHack } from "mongodb-middleware-utils";

// using MongoClientHack instance
const mongoServer = new MongoClientHack({
  map: {
    my_database_name: {
      // name of the database you want to intercept
      my_collection_name: {
        // name of collection you want to intercept
        random: true,
        fulltext: ["name", "des"],
      },
    },
    another_database_name: {
      another_collection_name: {
        random: true,
        fulltext: ["name", "des"],
      },
    },
    // you can have as many map as needed
    ...otherMapping,
  },
  tokenizer: (text) => string, // <--- handle text tokenization here
  url: "mongodb://127.0.0.1:27017",
  options: {
    useUnifiedTopology: true,
    ...otherProps,
  },
});

// using MongoClient
const mongoServer = new MongoClient("mongodb://127.0.0.1:27017");

proxyClient({
  map: {
    my_database_name: {
      // name of the database you want to intercept
      my_collection_name: {
        // name of collection you want to intercept
        random: true,
        fulltext: ["name", "des"],
      },
    },
    another_database_name: {
      another_collection_name: {
        random: true,
        fulltext: ["name", "des"],
      },
    },
    // you can have as many map as needed
    ...otherMapping,
  },
  tokenizer: (text) => string, // <--- handle text tokenization here
})(mongoServer);

// connect
mongoServer.connect();

const db = mongoServer.db("my_database_name");

// insert document
await db.collection("my_collection_name").insertOne({
  _id: "doc1",
  name: "ademola onabanjo",
  date: Date.now(),
  des: "Lorem ipsum dolor sit amet consectetur",
});
```

### searching text

```js
const nameOrDesFieldSearch = await db
  .collection()
  .find({ $text: { $search: "sit amet consec" } })
  .toArray();

// outputs:
// [{
//     _id: 'doc1',
//     name: 'ademola onabanjo',
//     date: Date.now(),
//     des: 'Lorem ipsum dolor sit amet consectetur'
// }]
console.log("searchResult: ", nameOrDesFieldSearch);

// search single field

const nameFieldSearch = await db
  .collection()
  .find({ $text: { $search: "onaba", $field: "name" } })
  .toArray();

// outputs:
// [{
//     _id: 'doc1',
//     name: 'ademola onabanjo',
//     date: Date.now(),
//     des: 'Lorem ipsum dolor sit amet consectetur'
// }]
console.log("searchResult: ", nameFieldSearch);
```

### random query

```js
// make sure you followed this process when querying random document ($sample at the first pipeline and $match at the second one)
// or else it fallback to using the native caller
const searchRes = await db.collection('my_collection_name').aggregate([
    { $sample: { $size: 5 } }
    { $match: { } }
]).limit(1).toArray();
```

## Document transformation

### fulltext index

Some write operations are proxied to add an extra field value to the document for querying random document and searching text.
Some read operations are also proxied to remove redundant field value so as not to overwhelm the memory.
The following methods are proxied on the collection instance to transform the document

- `insertOne`
- `insertMany`
- `updateOne` ($set, $setOnInsert, $unset)
- `replaceOne`
- `bulkWrite`
- `find`
- `findOne`
- `watch`
- `aggregate`

### $text transformation

`{ $text: { $search: 'onaba', $field: 'des' } }` is transformed to `{ $or: [...your-$Or-Props, { __fta_des: { $in: ['onaba'] } }] }`
while `{ $text: { $search: 'onaba', $field: ['name', 'des'] } }` is transformed to `{ $or: [...your-$Or-Props, { __fta_name: { $in: ['onaba'] } }, { __fta_des: { $in: ['onaba'] } }] }`

### read operation transformation

All field value starting with `__fta_` or equals to `__rdz` are removed for read operations (`find`, `findOne`, `watch`).

## Limitations

- As the maximum size of a document in mongodb is 16mb, Avoid saving more than 37,000 bytes of characters for fulltext field. this 37,000 chars can produce approximately 301,391 item of strings in an array weighing 11mb in size.

- Avoid nesting field you wants to enable for fulltext search, always place it at the first object iteration stage

- Avoid nesting $text, always place it at the first object iteration stage

## Cons

- Indexes in MongoDB are used to speed up search operations, but indexing large arrays can result in significantly increased index size

- MongoDB has a maximum document size limit (16 megabytes). If the array, along with other fields in the document, approaches or exceeds this limit, you may encounter issues

## License

MIT
