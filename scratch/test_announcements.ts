import { initDB } from '../src/db/init';
import { announcementSync } from '../src/services/announcementSync';

async function main() {
    try {
        console.log('Initializing DB for announcements test...');
        await initDB();
        
        console.log('Running announcement sync...');
        await announcementSync();
        
        console.log('Test complete. Exiting gracefully.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();
