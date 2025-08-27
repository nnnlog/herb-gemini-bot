import sqlite3 from 'sqlite3';

const db = new sqlite3.Database('./telegram_log.db', (err) => {
    if (err) {
        console.error("데이터베이스 연결 실패:", err.message);
    } else {
        console.log("로컬 SQLite 데이터베이스에 성공적으로 연결되었습니다.");
    }
});

export function initDb() {
    const messagesSql = `
    CREATE TABLE IF NOT EXISTS messages (
        message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        user_id INTEGER,
        is_bot BOOLEAN,
        text TEXT,
        reply_to_message_id INTEGER,
        command_type TEXT, -- 'image', 'chat' 등 명령어 종류 저장
        timestamp INTEGER,
        PRIMARY KEY (chat_id, message_id)
    )`;

    const filesSql = `
    CREATE TABLE IF NOT EXISTS message_files (
        file_id TEXT PRIMARY KEY,
        message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        file_type TEXT NOT NULL, 
        FOREIGN KEY (chat_id, message_id) REFERENCES messages(chat_id, message_id)
    )`;

    db.serialize(() => {
        db.run(messagesSql, (err) => {
            if (err) console.error("messages 테이블 생성 실패:", err);
        });
        db.run(filesSql, (err) => {
            if (err) console.error("message_files 테이블 생성 실패:", err);
        });
    });
}

export function logMessage(msg, botId, commandType = null) {
    db.serialize(() => {
        const msgSql = `INSERT OR REPLACE INTO messages 
                     (message_id, chat_id, user_id, is_bot, text, reply_to_message_id, command_type, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const msgParams = [
            msg.message_id,
            msg.chat.id,
            msg.from.id,
            msg.from.id === botId,
            msg.text || msg.caption,
            msg.reply_to_message ? msg.reply_to_message.message_id : null,
            commandType,
            msg.date
        ];
        db.run(msgSql, msgParams, (err) => {
            if (err) console.error("메시지 기록 실패:", msg.message_id, err);
        });

        const fileSql = `INSERT OR IGNORE INTO message_files (file_id, message_id, chat_id, file_type) VALUES (?, ?, ?, ?)`;

        if (msg.photo) {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            db.run(fileSql, [fileId, msg.message_id, msg.chat.id, 'photo'], (err) => {
                if (err) console.error("사진 파일 기록 실패:", fileId, err);
            });
        }

        if (msg.document && msg.document.mime_type.startsWith('image/')) {
            const fileId = msg.document.file_id;
            db.run(fileSql, [fileId, msg.message_id, msg.chat.id, 'document'], (err) => {
                if (err) console.error("문서 파일 기록 실패:", fileId, err);
            });
        }
    });
}

export function getMessage(chatId, messageId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT * FROM messages WHERE chat_id = ? AND message_id = ?`;
        db.get(sql, [chatId, messageId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getMessageFiles(chatId, messageId) {
    return new Promise((resolve, reject) => {
        const sql = `SELECT file_id FROM message_files WHERE chat_id = ? AND message_id = ?`;
        db.all(sql, [chatId, messageId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.file_id));
        });
    });
}

export async function getConversationHistory(chatId, startMessageId) {
    let history = [];
    let currentMessageId = startMessageId;
    const HISTORY_DEPTH_LIMIT = 15;

    while (currentMessageId && history.length < HISTORY_DEPTH_LIMIT) {
        const messageRow = await getMessage(chatId, currentMessageId);
        if (!messageRow) break;

        const fileIds = await getMessageFiles(chatId, messageRow.message_id);

        history.unshift({
            role: messageRow.is_bot ? 'model' : 'user',
            text: messageRow.text || '',
            imageFileIds: fileIds
        });

        currentMessageId = messageRow.reply_to_message_id;
    }
    return history;
}