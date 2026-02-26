// PocketBase 数据库迁移
// 为 transcripts 表添加 asr_engine 字段

migrate((db) => {
    const dao = new Dao(db)
    const collection = dao.findCollectionByNameOrId("transcripts")

    // 添加 asr_engine 字段
    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "asr_engine",
        "name": "asr_engine",
        "type": "select",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "maxSelect": 1,
            "values": [
                "aliyun",
                "whisper"
            ]
        }
    }))

    return dao.saveCollection(collection)
}, (db) => {
    // 回滚
    const dao = new Dao(db)
    const collection = dao.findCollectionByNameOrId("transcripts")

    // 移除字段
    collection.schema.removeField("asr_engine")

    return dao.saveCollection(collection)
})
