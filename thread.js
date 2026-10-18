import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { availableParallelism } from 'os';
import LimitTasks from 'limit-task';

let currentTask = -1;
const worker_list = [];

const MAX_WORKERS = Math.max(availableParallelism(), 7);

export const addTask = (input) => {
    if (++currentTask >= worker_list.length) {
        if (worker_list.length < MAX_WORKERS) {
            // spawn new engine on demand
            worker_list.push(spawnWorker());
        } else currentTask = 0;
    }
    return worker_list[currentTask](input);
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
    let closureError;

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

    const rejectPendingTasks = error => {
        const pendTasks = Object.entries(resolution);
        for (const [session, [_, reject]] of pendTasks) {
            delete resolution[session];
            reject(closureError?.error);
        }

        if (pendTasks.length) setTimeout(rejectPendingTasks, 90);

        for (let i = 0; i < worker_list.length; i++) {
            const thatCallback = worker_list[i];

            if (thatCallback === callback) {
                worker_list.splice(i, 1);
                currentTask = 0;
                break;
            }
        }
    };

    worker.on('error', err => {
        closureError = { error: err };
        rejectPendingTasks(err);
    });
    worker.on('exit', () => {
        if (!closureError) closureError = {};
        rejectPendingTasks();
    });

    const queue = LimitTasks(9);

    const callback = (input) =>
        queue(() =>
            new Promise((resolve, reject) => {
                if (closureError) {
                    reject(closureError.error);
                    return;
                }
                const session = `${++ite}`;

                resolution[session] = [resolve, reject];
                worker.postMessage({ input, session });
            })
        );

    return callback;
};