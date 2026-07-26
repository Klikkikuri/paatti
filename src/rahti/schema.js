/**
 * @fileoverview Schema validation and payload transformation for Rahti title data.
 * Verifies semantic versioning compatibility and transforms raw payload entries into keyed datasets.
 */

import { getLogger, parseSemVer } from "../utils.js";

/**
 * The supported schema version for the Rahti data format.
 * Major version changes indicate breaking changes, while minor and patch versions are backward compatible.
 */
const SUPPORTED_SCHEMA_VERSION = "0.1.0";

const log = getLogger("rahti:schema");

/**
 * Converts a Rahti data payload into a dictionary keyed by URL signatures.
 * 
 * @param {Object} rahti - The raw Rahti payload object.
 * @returns {Object} Dictionary mapping signatures to entry objects.
 */
function rahtiToKeyed(rahti) {
    const mapped = {};

    if (!rahti || !Array.isArray(rahti.entries)) {
        log("Invalid Rahti data structure:", rahti);
        return mapped;
    }
    
    for (const entry of rahti.entries) {
        if (!entry.urls || entry.urls.length === 0) {
            continue;
        }

        for (const urlEntry of entry.urls) {
            const sign = urlEntry.sign;
            if (!sign) {
                log(`URL entry missing sign:`, urlEntry);
                continue;
            }
            mapped[sign] = entry;
        }
    }

    return mapped;
}

/**
 * Validates a Rahti data payload against schema version requirements.
 * 
 * @param {Object} data - The Rahti payload object to validate.
 * @returns {boolean} True if payload is valid.
 * @throws {Error} If major schema version is incompatible.
 */
function validRahtiData(data) {
    if (!data || typeof data !== "object") {
        log("Invalid Rahti payload type:", data);
        return false;
    }

    if (!Array.isArray(data.entries)) {
        log("Invalid Rahti payload: missing entries array.", data);
        return false;
    }

    const supported = parseSemVer(SUPPORTED_SCHEMA_VERSION);
    const incoming = parseSemVer(data.schema_version);

    if (!supported || !incoming) {
        log("Could not parse schema version.", { supported: SUPPORTED_SCHEMA_VERSION, incoming: data ? data.schema_version : undefined });
        return false;
    }

    if (incoming.major !== supported.major) {
        throw new Error(`The title data format is not compatible: major version of data is ${incoming.major} when expected ${supported.major}. Update Paatti or use some other compatible title data source in order to fix.`);
    }

    return true;
}

export { SUPPORTED_SCHEMA_VERSION, rahtiToKeyed, validRahtiData };
