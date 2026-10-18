# mongodb-middleware-utils

**Extend MongoDB with custom full-text search, random document selection, and query index diagnostics — without changing your existing query patterns.**

`mongodb-middleware-utils` is a lightweight middleware utility for the official MongoDB Node.js driver. It intercepts selected collection operations to provide additional functionality that isn't directly available through MongoDB's standard community-edition features.

With a simple configuration, you can enable custom full-text search, prepare collections for random document selection, monitor queries that don't use indexes, and control how additional search data is stored.

## Features

- **Custom full-text search:** Search individual fields or multiple fields using the familiar `$text` query syntax.
- **Prefix-based matching:** Support partial-word searches, such as searching for `onaba` to find `onabanjo`.
- **Custom tokenization:** Supply your own tokenizer to accommodate different languages and word-segmentation requirements.
- **Random document selection:** Add randomization metadata to documents to support the package's optimized random-selection mechanism.
- **Isolated full-text storage:** Store full-text search data in a separate collection to avoid increasing the size of documents in your original collection.
- **Background processing:** Use MongoDB change streams to maintain additional search and randomization data asynchronously.
- **Index diagnostics:** Receive notifications when a query performs a collection scan instead of using an index.

## Table of Contents

- [Installation](#installation)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Full-Text Search](#full-text-search)
- [Random Document Selection](#random-document-selection)
- [Isolating Full-Text Data](#isolating-full-text-data)
- [Background Processing](#background-processing)
- [Index Diagnostics](#index-diagnostics)
- [API Reference](#api-reference)
- [Limitations and Considerations](#limitations-and-considerations)
- [License](#license)

## Installation

Install the package using npm:

```bash
npm install mongodb-middleware-utils
```

Or using Yarn:

```bash
yarn add mongodb-middleware-utils
```

The package integrates with the official MongoDB Node.js driver. Ensure that your project has a compatible version of `mongodb` installed.

## How It Works

MongoDB provides a native text-search feature, but its behavior differs from the partial-word and field-specific matching that some applications require.

This package provides an alternative by maintaining additional search data for configured collections.

For example, consider this document:

```javascript
{
  _id: "user-1",
  name: "Ademola Onabanjo",
  description: "Software developer"
}
```

When full-text search is enabled for the `name` field, the package maintains additional searchable data that can make partial-word queries possible.

You can then query the collection using:

```javascript
const users = await db.collection("users")
  .find({
    $text: {
      $search: "onaba",
      $field: "name"
    }
  })
  .toArray();
```

The package translates its custom `$text` query into a query against the generated search data.

Depending on your configuration, this additional data can be stored directly in the original collection or isolated in a separate collection.

**Important:** The package's `$text` syntax is custom middleware behavior. It is not the same as MongoDB's native `$text` operator, and its supported behavior depends on the configured collections and the middleware's query transformations.

## Quick Start

There are two ways to integrate the middleware:

1. Use `MongoClientHack`, which extends MongoDB's `MongoClient`.
2. Use `proxyClient` to intercept an existing `MongoClient` instance.

### Option 1: Using `MongoClientHack`

This is the simplest approach when creating a new MongoDB client.

```javascript
import { MongoClientHack } from "mongodb-middleware-utils";

const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",
  map: {
    my_database: {
      users: {
        fulltext: ["name", "description"],
        random: true
      }
    }
  }
});

await client.connect();

const db = client.db("my_database");

// Insert a document.
await db.collection("users").insertOne({
  name: "Ademola Onabanjo",
  description: "Software developer"
});

// Search across the configured full-text fields.
const users = await db.collection("users")
  .find({
    $text: {
      $search: "software"
    }
  })
  .toArray();

console.log(users);
```

The configuration enables full-text search on the `name` and `description` fields and enables randomization metadata for the `users` collection.

### Option 2: Using `proxyClient`

Use `proxyClient` when you already have a MongoDB client or want to configure interception separately from client construction.

```javascript
import { MongoClient } from "mongodb";
import { proxyClient } from "mongodb-middleware-utils";

const client = new MongoClient(
  "mongodb://127.0.0.1:27017"
);

const interception = proxyClient({
  map: {
    my_database: {
      users: {
        fulltext: ["name", "description"],
        random: true
      }
    }
  }
})(client);

await client.connect();

const db = client.db("my_database");

const users = await db.collection("users")
  .find({
    $text: {
      $search: "onaba",
      $field: "name"
    }
  })
  .toArray();

console.log(users);
```

`proxyClient` returns an object exposing `start()` and `end()` methods for background processing. You can use this object when the `overhead` option is enabled.

See [Background Processing](#background-processing) for details.

## Configuration

The `map` option determines which databases and collections the middleware intercepts.

Its structure is:

```javascript
{
  map: {
    databaseName: {
      collectionName: {
        // Collection-specific options.
      }
    }
  }
}
```

You can configure multiple databases and collections.

### Collection Options

Each collection accepts the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `fulltext` | `string \| string[]` | Not enabled | Field or fields to enable for full-text search. |
| `random` | `boolean` | `false` | Enables randomization metadata for the collection. |
| `isolateFullText` | `boolean` | `false` | Stores full-text search data separately from the original documents. |
| `overhead` | `boolean` | `false` | Enables background maintenance of additional metadata through MongoDB change streams. |
| `safeOverhead` | `boolean` | `false` | Prevents background processing from continuing to add searchable items when the document-size safety limit is reached. Only applies when `overhead` is enabled. |

Example:

```javascript
const config = {
  map: {
    my_database: {
      users: {
        fulltext: ["name", "email"],
        random: true,
        isolateFullText: true
      },

      articles: {
        fulltext: ["title", "content"],
        overhead: true,
        safeOverhead: true
      }
    }
  }
};
```

The `users` collection uses isolated full-text storage, while the `articles` collection uses background processing.

These are independent configuration choices; select the options that suit each collection's workload.

### Client Options

When using `MongoClientHack`, you can pass the MongoDB connection URL and standard client options.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  options: {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5000
  },

  map: {
    my_database: {
      users: {
        fulltext: ["name"],
        random: true
      }
    }
  }
});
```

The `url` and `options` properties configure the underlying MongoDB client.

When using `proxyClient`, create the `MongoClient` yourself and pass it to the middleware.

## Full-Text Search

Full-text search is enabled by specifying the fields you want to make searchable in the collection configuration.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      users: {
        fulltext: ["name", "description"]
      }
    }
  }
});
```

### Search Across Multiple Fields

When `$field` is omitted, the middleware searches across the configured full-text fields.

```javascript
const users = await db.collection("users")
  .find({
    $text: {
      $search: "software developer"
    }
  })
  .toArray();
```

### Search a Specific Field

Use `$field` to restrict the search to a particular configured field.

```javascript
const users = await db.collection("users")
  .find({
    $text: {
      $search: "onaba",
      $field: "name"
    }
  })
  .toArray();
```

### Search Multiple Specific Fields

You can also pass an array of field names.

```javascript
const users = await db.collection("users")
  .find({
    $text: {
      $search: "software",
      $field: ["name", "description"]
    }
  })
  .toArray();
```

The fields used in `$field` should be included in the collection's `fulltext` configuration.

### Custom Tokenization

Different languages have different rules for dividing text into searchable words. For example, some languages do not use spaces to separate words consistently.

You can provide a custom tokenizer to control how text is tokenized.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      articles: {
        fulltext: ["title", "content"]
      }
    }
  },

  tokenizer: async (text) => {
    // Replace this with your preferred tokenization logic.
    return text.toLowerCase();
  }
});
```

The tokenizer accepts a string and can return either a string or a promise resolving to a string.

The example above demonstrates the interface only. Lowercasing text is not a substitute for a language-aware tokenizer when your application requires proper word segmentation.

Choose a tokenizer that suits your application's language and search requirements.

## Random Document Selection

The `random` option enables randomization metadata for a collection.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      products: {
        random: true
      }
    }
  }
});
```

The middleware uses the internal `__rdz` field to support its random-document mechanism.

### Querying Random Documents

The middleware recognizes a particular aggregation pipeline structure that starts with `$sample`, followed by `$match`.

```javascript
const products = await db.collection("products")
  .aggregate([
    {
      $sample: {
        $size: 5
      }
    },
    {
      $match: {}
    }
  ])
  .toArray();
```

**Important:** This example demonstrates the expected pipeline structure, not a guarantee that the result contains five documents.

The middleware's optimized handling depends on the expected pipeline structure. Other pipeline arrangements may fall back to the MongoDB driver's native behavior.

Consult the implementation when relying on this optimization for a particular aggregation pipeline.

## Isolating Full-Text Data

Full-text search can introduce significant overhead when searchable terms are stored as arrays inside the original documents.

For collections containing large text fields, this extra data can increase document sizes and the cost of operations that do not need full-text search.

The `isolateFullText` option addresses this by storing full-text search data separately.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      articles: {
        fulltext: ["title", "content"],
        isolateFullText: true
      }
    }
  }
});
```

With this option enabled, the middleware maintains duplicated documents in a separate collection whose name uses the `__fta_` prefix. Queries using the middleware's `$text` syntax are executed against this separate collection.

The original collection therefore does not need to contain the full-text search arrays.

### When Should You Use It?

Consider enabling `isolateFullText` when:

- Documents contain large text fields.
- Full-text search is less frequent than ordinary reads.
- Most queries do not require searchable-term arrays.
- You want to reduce the storage overhead of full-text metadata in the original documents.

The trade-off is that isolated storage introduces additional data to maintain and additional considerations for reads and writes.

Choose the storage strategy based on your application's access patterns.

## Background Processing

By default, the middleware can intercept supported write operations to maintain the additional metadata as part of the write path.

For workloads where this extra processing is undesirable, the `overhead` option enables background maintenance through MongoDB change streams.

```javascript
import { MongoClientHack } from "mongodb-middleware-utils";

const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      articles: {
        fulltext: ["title", "content"],
        random: true,
        overhead: true,
        safeOverhead: true
      }
    }
  }
});

await client.connect();

// Start listening for changes.
client.overhead.start();
```

With background processing enabled, the middleware listens for data changes and maintains the additional search and randomization metadata asynchronously.

### Using `proxyClient`

The same lifecycle is available when using an existing client.

```javascript
import { MongoClient } from "mongodb";
import { proxyClient } from "mongodb-middleware-utils";

const client = new MongoClient(
  "mongodb://127.0.0.1:27017"
);

const interception = proxyClient({
  map: {
    my_database: {
      articles: {
        fulltext: ["title", "content"],
        overhead: true,
        safeOverhead: true
      }
    }
  }
})(client);

await client.connect();

interception.start();
// or
client.overhead.start();
```

### Stopping Background Processing

Call `end()` when you want to stop the change-stream listener.

```javascript
interception.end();
```

For a `MongoClientHack` instance:

```javascript
client.overhead.end();
```

**Important:** Background processing is asynchronous. Do not assume that the additional metadata is available immediately after a document is written.

Change streams also require a MongoDB deployment that supports them, such as a replica set or a sharded cluster. A standalone MongoDB server does not support change streams.

### Understanding `safeOverhead`

MongoDB limits the size of an individual BSON document to 16 MiB.

When generated full-text data becomes too large, it can cause writes to fail if the document exceeds this limit.

The `safeOverhead` option helps avoid this particular problem by stopping the addition of searchable items when the configured safety limit is reached.

```javascript
{
  fulltext: ["content"],
  overhead: true,
  safeOverhead: true
}
```

This is a safety mechanism, not a guarantee that every document will remain below MongoDB's size limit under all circumstances.

It applies only when `overhead` is enabled.

## Index Diagnostics

The `indexNotice` option lets you monitor queries that do not use an index scan.

This can help identify queries that may benefit from additional indexes during development and debugging.

### Log Warnings

Set `indexNotice` to `"warn"` to use `console.warn`.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      users: {}
    }
  },

  indexNotice: "warn"
});
```

### Throw Errors

Set `indexNotice` to `"error"` to throw an error for each `find` operation identified by the middleware as not using an index scan.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      users: {}
    }
  },

  indexNotice: "error"
});
```

Use this mode carefully. It can interrupt normal query execution and is generally better suited to controlled development or testing environments.

### Provide a Custom Callback

You can provide a callback to handle query-plan information yourself.

```javascript
const client = new MongoClientHack({
  url: "mongodb://127.0.0.1:27017",

  map: {
    my_database: {
      users: {}
    }
  },

  indexNotice: (explanation) => {
    console.log("Query explanation:", explanation);
  }
});
```

The callback receives a MongoDB document containing the explanation information.

Use it to integrate diagnostics with your existing logging or monitoring system.

### Disable Diagnostics

Set `indexNotice` to `"off"` or leave it undefined to disable index diagnostics.

```javascript
{
  map: {
    my_database: {
      users: {}
    }
  },

  indexNotice: "off"
}
```

The declaration recommends leaving diagnostics disabled in production unless you specifically need them, since inspecting query plans can introduce additional processing overhead.

## API Reference

### `MongoClientHack`

A class extending the MongoDB driver's `MongoClient`.

```javascript
new MongoClientHack(config)
```

The configuration accepts:

| Property | Type | Description |
|---|---|---|
| `url` | `string` | MongoDB connection URL. |
| `options` | `MongoClientOptions` | Standard MongoDB client options. |
| `map` | `InterceptionMap` | Database and collection interception configuration. |
| `tokenizer` | `(text: string) => string \| Promise<string>` | Optional custom text tokenizer. |
| `indexNotice` | `function \| "warn" \| "error" \| "off"` | Optional index diagnostic handler. |

The instance exposes an `overhead` object with `start()` and `end()` methods for controlling background change-stream processing.

### `proxyClient(config)`

Configures interception for an existing `MongoClient`.

```javascript
const interception = proxyClient(config)(client);
```

The function returns an object with the following methods:

| Method | Description |
|---|---|
| `start()` | Starts the background change-stream listener. |
| `end()` | Stops the background change-stream listener. |

Use these methods when background processing is enabled.

### `getFulltextArray(text)`

An exported asynchronous utility.

```javascript
import { getFulltextArray } from "mongodb-middleware-utils";

const terms = await getFulltextArray("Hello world");
```

Returns a promise resolving to an array of strings.

### Internal Field Constants

The package exports two constants:

```javascript
import {
  FULLTEXT_ARRAY_PREFIX,
  RANDOMIZER_FIELD
} from "mongodb-middleware-utils";

console.log(FULLTEXT_ARRAY_PREFIX); // "__fta_"
console.log(RANDOMIZER_FIELD);      // "__rdz"
```

- `FULLTEXT_ARRAY_PREFIX` identifies the prefix used for generated full-text fields and isolated full-text collections.
- `RANDOMIZER_FIELD` identifies the internal randomization field.

These names are part of the middleware's internal storage conventions. Avoid using the same names for unrelated application data.

## Limitations and Considerations

### 1. MongoDB Document Size

MongoDB imposes a 16 MiB BSON document size limit.

Generated search arrays can increase the size of documents significantly, particularly when indexing long text fields.

Consider using `overhead` with `safeOverhead` to limit additional searchable items during background processing.

### 2. Searchable Fields

Configure the fields you want to search explicitly.

```javascript
{
  fulltext: ["name", "description"]
}
```

Avoid relying on nested-field behavior unless it is supported by the implementation. The original middleware design expects configured searchable fields to be at the top level of the document.

### 3. Query Structure

The package implements its own `$text` query transformation.

Use the documented query structure, and avoid assuming that the custom operator supports every feature of MongoDB's native query language.

Likewise, the optimized random-selection behavior depends on the expected aggregation pipeline structure.

### 4. Background Processing

The `overhead` option maintains metadata asynchronously.

Applications that need searchable data to be immediately available and consistent with a recent write should omitt or set `overhead` to false.

### 5. Indexing Costs

Indexes can improve query performance, but indexing large arrays can increase index size and write overhead.

Evaluate the indexes required by your application's actual queries and data volume.

### 6. Index Diagnostics Overhead

Index diagnostics can add processing overhead. Enable them selectively, should be disable in production environments.

### 7. Additional Storage

Enabling `isolateFullText` duplicates documents into a separate collection for search purposes.

Plan for the additional storage, maintenance, and operational considerations associated with this data.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.