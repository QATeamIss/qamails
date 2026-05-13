const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const http = require('isomorphic-git/http/node');
require('dotenv').config();

const dir = __dirname;
const url = process.env.GITHUB_REPO;
const token = process.env.GITHUB_PAT;

async function push() {
    console.log('🚀 Initializing Git...');
    
    // Check if .git exists
    if (!fs.existsSync(path.join(dir, '.git'))) {
        await git.init({ fs, dir });
    }

    console.log('📦 Staging files...');
    // Add all files
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
        if (file !== '.git' && file !== 'node_modules') {
            await git.add({ fs, dir, filepath: file });
        }
    }

    console.log('✍️ Committing...');
    await git.commit({
        fs,
        dir,
        author: {
            name: 'QA Automation',
            email: 'qa@automation.com'
        },
        message: 'Initial push to GitHub with Supabase integration'
    });

    console.log('🌿 Ensuring main branch...');
    await git.branch({ fs, dir, ref: 'main', checkout: true, force: true });

    console.log('🔗 Adding remote...');
    try {
        await git.addRemote({ fs, dir, remote: 'origin', url });
    } catch (e) {
        // Remote might already exist
    }

    console.log('⬆️ Pushing to GitHub...');
    await git.push({
        fs,
        http,
        dir,
        remote: 'origin',
        ref: 'main',
        onAuth: () => ({ username: token })
    });

    console.log('✅ Successfully pushed to GitHub!');
}

push().catch(err => {
    console.error('❌ Push failed:', err);
    process.exit(1);
});
