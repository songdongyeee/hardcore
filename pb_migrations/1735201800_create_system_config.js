/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
    const collection = new Collection({
        "id": "system_config_001",
        "created": "2025-12-26 16:30:00.123Z",
        "updated": "2025-12-26 16:30:00.123Z",
        "name": "system_config",
        "type": "base",
        "system": false,
        "schema": [
            {
                "system": false,
                "id": "config_key_idx",
                "name": "key",
                "type": "text",
                "required": true,
                "presentable": true,
                "unique": true,
                "options": {
                    "min": null,
                    "max": null,
                    "pattern": ""
                }
            },
            {
                "system": false,
                "id": "config_val_idx",
                "name": "value",
                "type": "json",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": {}
            }
        ],
        "indexes": [
            "CREATE UNIQUE INDEX `idx_config_key` ON `system_config` (`key`)"
        ],
        "listRule": "",
        "viewRule": "",
        "createRule": null,
        "updateRule": null,
        "deleteRule": null,
        "options": {}
    });

    return Dao(db).saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("system_config");

    return dao.deleteCollection(collection);
})
