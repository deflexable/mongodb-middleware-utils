import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { availableParallelism } from 'os';
import LimitTasks from 'limit-task';

let currentTask = -1;
const e2e_engines = [];

const MAX_WORKERS = Math.max(availableParallelism(), 7);

export const addTask = (input) => {
    if (++currentTask >= e2e_engines.length) {
        if (e2e_engines.length < MAX_WORKERS) {
            // spawn new engine on demand
            e2e_engines.push(spawnWorker());
        } else currentTask = 0;
    }
    return e2e_engines[currentTask](input);
}

const getDirname = () => {
    if (typeof __dirname !== 'undefined') return __dirname;
    return dirname(fileURLToPath(import.meta.url));
}

const __dirnamePath = getDirname();

const spawnWorker = () => {
    const resolution = {};
    let ite = 0;
    const worker = new Worker(`${__dirnamePath}/worker.js`);

    // Receive the result from the worker
    worker.on('message', function (event) {
        const [response, session, error] = event;
        if (error) {
            resolution[session][1](error.error);
        } else {
            resolution[session][0](response);
        }
        delete resolution[session];
    });

    const queue = LimitTasks(9);

    return (input) =>
        queue(() =>
            new Promise((resolve, reject) => {
                const session = `${++ite}`;

                resolution[session] = [resolve, reject];
                worker.postMessage({ input, session });
            })
        );
};