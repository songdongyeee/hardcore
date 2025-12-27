/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Add waveform_data field to transcripts collection
 */

migrate((db) => {
    const dao = new Dao(db);

    try {
        const collection = dao.findCollectionByNameOrId("transcripts");

        // Add waveform_data field
        collection.schema.addField(new SchemaField({
            system: false,
            id: "waveform_data",
            name: "waveform_data",
            type: "json",
            required: false,
            presentable: false,
            unique: false,
            options: {
                maxSize: 2000000  // 2MB max
            }
        }));

        dao.saveCollection(collection);

        console.log("[Migration] Added waveform_data field to transcripts collection");
    } catch (e) {
        console.error("[Migration] Failed to add waveform_data field:", e);
        throw e;
    }
}, (db) => {
    // Rollback
    const dao = new Dao(db);

    try {
        const collection = dao.findCollectionByNameOrId("transcripts");

        // Remove waveform_data field
        collection.schema.removeField("waveform_data");

        dao.saveCollection(collection);

        console.log("[Migration] Removed waveform_data field from transcripts collection");
    } catch (e) {
        console.error("[Migration] Rollback failed:", e);
    }
});
