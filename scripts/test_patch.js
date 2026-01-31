
import PocketBase from 'pocketbase';
import fs from 'fs';
import FormData from 'form-data';

const PB_URL = 'https://zjcnex.top';
const pb = new PocketBase(PB_URL);

async function main() {
    console.log("Login...");
    // Legacy login
    const authData = await pb.send('/api/admins/auth-with-password', {
        method: 'POST',
        body: { identity: '993789049@qq.com', password: 'Zhouji107178' }
    });
    pb.authStore.save(authData.token, authData.admin);

    console.log("Step 1: Create with tiny file...");
    const formData = new FormData();
    formData.append('audio', fs.createReadStream('test_tiny.mp3'), 'test_tiny.mp3');
    formData.append('title', 'Patch Test');
    formData.append('status', 'pending');

    const record = await pb.collection('transcripts').create(formData);
    console.log(`Created ID: ${record.id}`);

    console.log("Step 2: Update with 1MB file...");
    const formUpdate = new FormData();
    formUpdate.append('audio', fs.createReadStream('test_1mb.mp3'), 'test_1mb_real.mp3');

    const updated = await pb.collection('transcripts').update(record.id, formUpdate);
    console.log("Update success!", updated.id);
}

main().catch(console.error);
