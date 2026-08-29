const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('./database');

function ask(rl, question) {
    return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function askSecret(question) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.isTTY) return reject(new Error('Run this command in an interactive terminal.'));
        process.stdout.write(question);
        let value = '';
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const finish = () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(value);
        };
        const onData = key => {
            if (key === '\r' || key === '\n') return finish();
            if (key === '\u0003') { process.stdin.setRawMode(false); process.exit(130); }
            if (key === '\u0008' || key === '\u007f') { value = value.slice(0, -1); return; }
            if (key >= ' ') value += key;
        };
        process.stdin.on('data', onData);
    });
}

(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const username = await ask(rl, 'Admin username: ');
        rl.close();
        if (!username) throw new Error('Username is required.');
        const password = await askSecret('Password (minimum 8 characters): ');
        if (password.length < 8) throw new Error('Password must be at least 8 characters.');
        const confirmation = await askSecret('Confirm password: ');
        if (password !== confirmation) throw new Error('Passwords do not match.');
        const passwordHash = await bcrypt.hash(password, 12);
        const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
        if (existing) {
            db.prepare(`UPDATE users SET password_hash = ?, role = 'admin', is_active = 1,
                session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(passwordHash, existing.id);
            console.log(`Admin "${username}" updated safely.`);
        } else {
            db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, passwordHash);
            console.log(`Admin "${username}" created.`);
        }
    } catch (error) {
        rl.close();
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
})();
