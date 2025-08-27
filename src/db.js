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
        file_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        file_type TEXT NOT NULL, 
        FOREIGN KEY (chat_id, message_id) REFERENCES messages(chat_id, message_id),
        PRIMARY KEY (chat_id, message_id, file_id)
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

export async function logMessage(msg, botId, commandType = null) {
    // 1. 답장한 원본 메시지가 있고, DB에 없는 경우 먼저 저장합니다.
    if (msg.reply_to_message) {
        const originalMsg = msg.reply_to_message;
        const existingMsg = await getMessage(originalMsg.chat.id, originalMsg.message_id);
        if (!existingMsg) {
            console.log(`[logMessage] DB에 없는 원본 메시지(${originalMsg.message_id})를 저장합니다.`);
            await logMessage(originalMsg, botId); // 재귀 호출로 원본 메시지 저장
        }
    }

    // 2. 현재 메시지를 저장합니다. (Promise로 감싸서 비동기 완료를 보장)
    return new Promise((resolve, reject) => {
        const msgSql = `INSERT OR REPLACE INTO messages (message_id, chat_id, user_id, is_bot, text, reply_to_message_id, command_type, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const msgParams = [
            msg.message_id, msg.chat.id, msg.from.id, msg.from.id === botId,
            msg.text || msg.caption,
            msg.reply_to_message ? msg.reply_to_message.message_id : null,
            commandType, msg.date
        ];

        db.run(msgSql, msgParams, function (err) {
            if (err) {
                console.error("messages 테이블 저장 실패:", err);
                return reject(err);
            }

            if (msg.photo || (msg.document && msg.document.mime_type.startsWith('image/'))) {
                const fileSql = `INSERT OR IGNORE INTO message_files (file_id, message_id, chat_id, file_type) VALUES (?, ?, ?, ?)`;
                const file = msg.photo ? msg.photo[msg.photo.length - 1] : msg.document;
                const fileType = msg.photo ? 'photo' : 'document';
                const fileParams = [file.file_id, msg.message_id, msg.chat.id, fileType];

                db.run(fileSql, fileParams, function (err) {
                    if (err) {
                        console.error("message_files 테이블 저장 실패:", err);
                        return reject(err);
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
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

function getFileIdsFromMsg(msg) {
    const fileIds = [];
    if (msg.photo) {
        fileIds.push(msg.photo[msg.photo.length - 1].file_id);
    }
    if (msg.document && msg.document.mime_type.startsWith('image/')) {
        fileIds.push(msg.document.file_id);
    }
    return fileIds;
}

export async function getConversationHistory(chatId, startMsg) {
    let history = [];
    let currentMsg = startMsg;
    const HISTORY_DEPTH_LIMIT = 15;
    const seenMessageIds = new Set(); // 무한 루프 방지

    while (currentMsg && history.length < HISTORY_DEPTH_LIMIT && !seenMessageIds.has(currentMsg.message_id)) {
        seenMessageIds.add(currentMsg.message_id);

        // DB에서 추가 정보(command_type 등)를 가져오려고 시도합니다.
        const messageRow = await getMessage(chatId, currentMsg.message_id);

        // 라이브 메시지 객체의 데이터를 기본으로 사용하고, DB 데이터로 보강합니다.
        const text = messageRow?.text ?? (currentMsg.text || currentMsg.caption) ?? '';
        const isBot = currentMsg.from.is_bot; // 라이브 객체의 is_bot이 더 신뢰성 높음

        // 라이브 객체에서 파일 ID를 먼저 가져옵니다.
        let fileIds = getFileIdsFromMsg(currentMsg);
        // 라이브 객체에 파일이 없고 DB에만 있는 경우(오래된 메시지)를 위해 DB에서도 조회합니다.
        if (fileIds.length === 0 && messageRow) {
            fileIds = await getMessageFiles(chatId, messageRow.message_id);
        }

        history.unshift({
            role: isBot ? 'model' : 'user',
            text: text,
            imageFileIds: fileIds
        });

        // 답장 체인을 따라 올라갑니다.
        if (currentMsg.reply_to_message) {
            currentMsg = currentMsg.reply_to_message;
        } else if (messageRow && messageRow.reply_to_message_id) {
            // 라이브 객체 체인이 끝나면, DB의 ID를 이용해 계속 탐색합니다.
            const nextMsgRow = await getMessage(chatId, messageRow.reply_to_message_id);
            // DB row를 루프에서 계속 사용할 수 있도록 pseudo-message 객체로 변환합니다.
            currentMsg = nextMsgRow ? { message_id: nextMsgRow.message_id, from: { is_bot: nextMsgRow.is_bot }, text: nextMsgRow.text, reply_to_message_id: nextMsgRow.reply_to_message_id } : null;
        } else {
            currentMsg = null;
        }
    }
    return history;
}