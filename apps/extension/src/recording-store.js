const DB_NAME = "spool-extension-db";
const DB_VERSION = 1;
const RECORDINGS_STORE = "recordings";
const LATEST_RECORDING_ID = "latest";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
        database.createObjectStore(RECORDINGS_STORE, {
          keyPath: "id"
        });
      }
    });

    request.addEventListener("success", () => {
      resolve(request.result);
    });

    request.addEventListener("error", () => {
      reject(request.error || new Error("Failed to open the recording database."));
    });
  });
}

function withStore(mode, callback) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(RECORDINGS_STORE, mode);
        const store = transaction.objectStore(RECORDINGS_STORE);
        let settled = false;

        transaction.addEventListener("complete", () => {
          if (!settled) {
            resolve(undefined);
          }
          database.close();
        });

        transaction.addEventListener("error", () => {
          reject(transaction.error || new Error("Recording database transaction failed."));
          database.close();
        });

        transaction.addEventListener("abort", () => {
          reject(transaction.error || new Error("Recording database transaction was aborted."));
          database.close();
        });

        callback(store, {
          resolve: (value) => {
            settled = true;
            resolve(value);
          },
          reject: (error) => {
            settled = true;
            reject(error);
          }
        });
      })
  );
}

export function getLatestRecording() {
  return withStore("readonly", (store, handlers) => {
    const request = store.get(LATEST_RECORDING_ID);

    request.addEventListener("success", () => {
      handlers.resolve(request.result ?? null);
    });

    request.addEventListener("error", () => {
      handlers.reject(request.error || new Error("Failed to read the latest recording."));
    });
  });
}

export function saveLatestRecording(recording) {
  return withStore("readwrite", (store, handlers) => {
    const request = store.put({
      id: LATEST_RECORDING_ID,
      shareId: "",
      shareUrl: "",
      ...recording
    });

    request.addEventListener("success", () => {
      handlers.resolve(request.result);
    });

    request.addEventListener("error", () => {
      handlers.reject(request.error || new Error("Failed to save the latest recording."));
    });
  });
}

export async function updateLatestRecording(patch) {
  const currentRecording = await getLatestRecording();
  if (!currentRecording) {
    return null;
  }

  await saveLatestRecording({
    ...currentRecording,
    ...patch
  });

  return getLatestRecording();
}

export function clearLatestRecording() {
  return withStore("readwrite", (store, handlers) => {
    const request = store.delete(LATEST_RECORDING_ID);

    request.addEventListener("success", () => {
      handlers.resolve(true);
    });

    request.addEventListener("error", () => {
      handlers.reject(request.error || new Error("Failed to clear the latest recording."));
    });
  });
}
