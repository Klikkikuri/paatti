import { getLogger, browser } from "./utils.js";
import { getConfig } from "./config.js";
import { initStorage } from "./storage.js";

const log = getLogger("rahti");

let rahtiStorage = initStorage("rahtiData");

function rahtiToKeyed(rahti) {
    const mapped = {};

    if (!rahti || !rahti.entries) {
        log("Invalid Rahti data structure:", rahti);
        return mapped;
    }
    
    for (const entry of rahti.entries) {
        if (!entry.urls || entry.urls.length === 0) {
            continue;
        }

        // Extract sign from each URL and create individual entries
        for (const urlEntry of entry.urls) {
            const sign = urlEntry.sign;
            if (!sign) {
                log(`URL entry missing sign: ${urlEntry}`);
                continue;
            }
            mapped[sign] = entry;
        }
    }

    return mapped;
}

function validRahtiData(data) {
    const SUPPORTED_SCHEMA_VERSION = "0.1.0";
    if (!data || typeof data !== "object") {
        log("Invalid Rahti payload type:", data);
        return false;
    }

    if (!Array.isArray(data.entries)) {
        log("Invalid Rahti payload: missing entries array.", data);
        return false;
    }

    if (data.schema_version != SUPPORTED_SCHEMA_VERSION) {
        // TODO: What now? Navigate the user to an update page?
        throw `The title data format is not compatible: version is ${data.schema_version} when expected ${SUPPORTED_SCHEMA_VERSION}. Update Paatti or use some other compatible title data source in order to fix.`;
    }

    return true;
}

async function fetchRahtiData() {
    // TODO: Implement not modified checks with ETag/Last-Modified headers
    log("Starting fetch of Rahti data...");
    const config = await getConfig();

    // Ensure rahtiStorage is initialized
    rahtiStorage = await rahtiStorage;

    const urls = config.titleDataUrls || [];
    
    log("Configured Rahti data URLs:", urls);
    if (urls.length === 0) {
        log("No URLs configured for fetching Rahti data.");
        return false;
    }

    log(`Fetching Rahti data from ${urls.length} URL(s) in parallel...`);

    // Fetch all URLs in parallel
    const fetchPromises = urls.map(url => 
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => ({ success: data.status == "ok", url, data }))
            .catch(error => {
                log(`Failed to fetch from ${url}:`, error.message);
                return { success: false, url, error: error.message };
            })
    );

    const results = await Promise.all(fetchPromises);
 
    // Process results
    const successfulResults = results.filter(r => r.success && validRahtiData(r.data));
    const failedResults = results.filter(r => !r.success);
    
    log(`Fetched ${successfulResults.length} successful and ${failedResults.length} failed results.`);

    if (successfulResults.length > 0) {
        // Get current keys before updating
        const oldKeys = new Set(rahtiStorage.getKeys());

        log("Merging fetched Rahti data...");

        // Merge all successful data and convert to keyed structure
        const mergedData = successfulResults.reduce((acc, result) => {
            const keyedData = rahtiToKeyed(result.data);
            return { ...acc, ...keyedData };
        }, {});
        log(`Merged data contains ${Object.keys(mergedData).length} entries (old had ${oldKeys.size})`);

        // Update storage with merged data, and remove old entries not in new data
        await rahtiStorage.store(mergedData);

        const newKeys = new Set(Object.keys(mergedData));
        const keysToRemove = Array.from(oldKeys).filter(key => !newKeys.has(key));
        
        log(`Removing ${keysToRemove.length} old entries not present in the new dataset.`);
        if (keysToRemove.length > 0) {
            await rahtiStorage.remove(keysToRemove);
            log(`Removed ${keysToRemove.length} old entries that are no longer in the dataset.`);
        }
        
        log(`Successfully fetched and stored Rahti data from ${successfulResults.length}/${urls.length} URL(s).`);
        try {
            await browser().storage.local.set({ lastDatabaseUpdate: Date.now() });
        } catch (e) {
            log("Failed to save database update timestamp:", e);
        }
        return true;
    } else {
        log("All attempts to fetch Rahti data failed.");
        if (failedResults.length > 0) {
            log(`Failed URLs: ${failedResults.map(r => r.url).join(', ')}`);
        }
        return false;
    }
}

export { fetchRahtiData, rahtiStorage };
