// PocketBase 数据库迁移
// 为 transcripts 表添加 ts_fix_status 字段（手动标记待修复）

migrate((db) => {
    const dao = new Dao(db)
    const collection = dao.findCollectionByNameOrId("transcripts")

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "ts_fix_status",
        "name": "ts_fix_status",
        "type": "select",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "maxSelect": 1,
            "values": [
                "pending",
                "pending_translate",
                "processing",
                "done",
                "error"
            ]
        }
    }))

    return dao.saveCollection(collection)
}, (db) => {
    const dao = new Dao(db)
    const collection = dao.findCollectionByNameOrId("transcripts")

    collection.schema.removeField("ts_fix_status")

    return dao.saveCollection(collection)
})
