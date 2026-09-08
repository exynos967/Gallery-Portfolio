import { StorageConfigurationError } from "../_lib/config-store.js";
import { json } from "../_lib/http.js";

export async function onRequest(context) {
  try {
    return await context.next();
  } catch (error) {
    if (!(error instanceof StorageConfigurationError)) throw error;
    return json(
      { success: false, error: "storage-not-configured", message: error.message },
      { status: 503 }
    );
  }
}
