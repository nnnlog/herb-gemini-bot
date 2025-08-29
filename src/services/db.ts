import sqlite3 from 'sqlite3';
import TelegramBot from "node-telegram-bot-api";

const db = new sqlite3.Database('./telegram_log.db', (err) => {
    if (err) console.error("데이터베이스 연결 실패:", err.message);
    else console.log("로컬 SQLite 데이터베이스에 성공적으로 연결되었습니다.");
});

// 데이터베이스 스키마 및 대화 기록을 위한 인터페이스
interface MessageMetadata {
    chat_id: number;
    message_id: number;
    command_type: string | null;
}

interface Attachment {
    file_unique_id: string;
    file_id: string;
    type: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
    width?: number;
    height?: number;
}

export interface ConversationTurn {
    role: 'user' | 'model';
    text: string;
    files: Attachment[];
}

// DB 초기화 함수
export function initDb() {
    const createRawMessagesTable = `
    CREATE TABLE IF NOT EXISTS raw_messages (
        message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        user_id INTEGER,
        timestamp INTEGER,
        data TEXT NOT NULL,
        PRIMARY KEY (chat_id, message_id)
    )`;

    const createAttachmentsTable = `
    CREATE TABLE IF NOT EXISTS attachments (
        file_unique_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        type TEXT NOT NULL,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        width INTEGER,
        height INTEGER
    )`;

    const createMessageAttachmentsTable = `
    CREATE TABLE IF NOT EXISTS message_attachments (
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        file_unique_id TEXT NOT NULL,
        FOREIGN KEY (chat_id, message_id) REFERENCES raw_messages(chat_id, message_id),
        FOREIGN KEY (file_unique_id) REFERENCES attachments(file_unique_id),
        PRIMARY KEY (chat_id, message_id, file_unique_id)
    )`;

    const createMessageMetadataTable = `
    CREATE TABLE IF NOT EXISTS message_metadata (
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        command_type TEXT,
        FOREIGN KEY (chat_id, message_id) REFERENCES raw_messages(chat_id, message_id),
        PRIMARY KEY (chat_id, message_id)
    )`;

    db.serialize(() => {
        db.run(createRawMessagesTable);
        db.run(createAttachmentsTable);
        db.run(createMessageAttachmentsTable);
        db.run(createMessageMetadataTable);
    });
}

// 메시지 로깅 메인 함수
export async function logMessage(msg: TelegramBot.Message, botId: number, commandType: string | null = null) {
    // 1. 원본 메시지 저장
    const rawSql = `INSERT OR REPLACE INTO raw_messages (message_id, chat_id, user_id, timestamp, data) VALUES (?, ?, ?, ?, ?)`;
    await dbRun(rawSql, [msg.message_id, msg.chat.id, msg.from?.id ?? null, msg.date, JSON.stringify(msg)]);

    // 2. 첨부파일 정보 저장
    const files = getFilesFromMsg(msg);
    for (const file of files) {
        const attachSql = `INSERT OR IGNORE INTO attachments (file_unique_id, file_id, type, file_name, file_size, mime_type, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        await dbRun(attachSql, [
            file.file_unique_id, file.file_id, file.type, file.file_name ?? null,
            file.file_size ?? null, file.mime_type ?? null, file.width ?? null, file.height ?? null
        ]);
        const linkSql = `INSERT OR IGNORE INTO message_attachments (chat_id, message_id, file_unique_id) VALUES (?, ?, ?)`;
        await dbRun(linkSql, [msg.chat.id, msg.message_id, file.file_unique_id]);
    }

    // 3. 프로그램 메타데이터 저장
    if (commandType) {
        const metaSql = `INSERT OR REPLACE INTO message_metadata (chat_id, message_id, command_type) VALUES (?, ?, ?)`;
        await dbRun(metaSql, [msg.chat.id, msg.message_id, commandType]);
    }

    // 4. 답장 메시지가 DB에 없는 경우 재귀적으로 저장
    if (msg.reply_to_message) {
        const originalMsg = msg.reply_to_message;
        const existingMsg = await getMessage(originalMsg.chat.id, originalMsg.message_id);
        if (!existingMsg) {
            console.log(`[logMessage] DB에 없는 원본 메시지(${originalMsg.message_id})를 저장합니다.`);
            logMessage(originalMsg, botId);
        }
    }
}

// 특정 메시지 정보 가져오기 (JSON 파싱 포함)
export async function getMessage(chatId: number, messageId: number): Promise<TelegramBot.Message | null> {
    const row = await dbGet<{ data: string }>(`SELECT data FROM raw_messages WHERE chat_id = ? AND message_id = ?`, [chatId, messageId]);
    return row ? JSON.parse(row.data) : null;
}

// 특정 메시지의 메타데이터 가져오기
export async function getMessageMetadata(chatId: number, messageId: number): Promise<MessageMetadata | null> {
    return dbGet<MessageMetadata>(`SELECT * FROM message_metadata WHERE chat_id = ? AND message_id = ?`, [chatId, messageId]);
}

// 앨범 ID로 그룹 전체 메시지 가져오기
export function getAlbumMessages(chatId: number, mediaGroupId: string): Promise<TelegramBot.Message[]> {
    return new Promise((resolve, reject) => {
        const sql = `SELECT data FROM raw_messages WHERE chat_id = ? AND json_extract(data, '$.media_group_id') = ? ORDER BY message_id ASC`;
        db.all(sql, [chatId, mediaGroupId], (err, rows: {data: string}[]) => {
            if (err) reject(err);
            else resolve(rows.map(r => JSON.parse(r.data)));
        });
    });
}

// 특정 메시지의 첨부파일 정보 가져오기
async function getAttachmentsForMessage(chatId: number, messageId: number): Promise<Attachment[]> {
    const sql = `
        SELECT a.* FROM attachments a
        JOIN message_attachments ma ON a.file_unique_id = ma.file_unique_id
        WHERE ma.chat_id = ? AND ma.message_id = ?
    `;
    return dbAll<Attachment>(sql, [chatId, messageId]);
}

// 대화 기록 생성 함수
export async function getConversationHistory(chatId: number, startMsg: TelegramBot.Message): Promise<ConversationTurn[]> {
    let history: ConversationTurn[] = [];
    let currentMsg: TelegramBot.Message | null = startMsg;
    const HISTORY_DEPTH_LIMIT = 15;
    const seenMessageIds = new Set<number>();

    while (currentMsg && history.length < HISTORY_DEPTH_LIMIT && !seenMessageIds.has(currentMsg.message_id)) {
        seenMessageIds.add(currentMsg.message_id);

        let files: Attachment[] = [];
        // 메시지에 media_group_id가 있으면, 그룹 전체의 첨부파일을 가져옵니다.
        if (currentMsg.media_group_id) {
            const groupMessages = await getAlbumMessages(chatId, currentMsg.media_group_id);
            for (const groupMsg of groupMessages) {
                // 다른 그룹 멤버들도 처리한 것으로 간주하여 중복 순회를 방지합니다.
                seenMessageIds.add(groupMsg.message_id);
                const groupFiles = await getAttachmentsForMessage(chatId, groupMsg.message_id);
                files.push(...groupFiles);
            }
        } else {
            // 미디어 그룹이 아닌 경우, 해당 메시지의 파일만 가져옵니다.
            const liveFiles = getFilesFromMsg(currentMsg);
            const dbFiles = await getAttachmentsForMessage(chatId, currentMsg.message_id);
            const allFiles = [...liveFiles, ...dbFiles];
            const uniqueFileIds = new Set<string>();
            files = allFiles.filter(file => {
                if (!file || uniqueFileIds.has(file.file_unique_id)) return false;
                uniqueFileIds.add(file.file_unique_id);
                return true;
            });
        }

        history.unshift({
            role: currentMsg.from?.is_bot ? 'model' : 'user',
            text: currentMsg.text || currentMsg.caption || '',
            files: files
        });

        // 다음 메시지로 이동
        if (currentMsg.reply_to_message) {
            // 실시간 reply 객체가 있으면 DB 조회 전에 그것을 우선 사용
            currentMsg = currentMsg.reply_to_message;
        } else {
            // live 객체가 끝나면 DB에 저장된 full message 객체를 기반으로 다음 메시지를 찾음
            const fullMsgFromDb = await getMessage(chatId, currentMsg.message_id);
            if (fullMsgFromDb && fullMsgFromDb.reply_to_message) {
                currentMsg = await getMessage(chatId, fullMsgFromDb.reply_to_message.message_id);
            } else {
                currentMsg = null;
            }
        }
    }
    return history;
}

// 헬퍼: 메시지에서 파일 정보 추출
function getFilesFromMsg(msg: TelegramBot.Message): Attachment[] {
    const files: Attachment[] = [];
    if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        files.push({
            type: 'photo',
            file_unique_id: photo.file_unique_id,
            file_id: photo.file_id,
            file_name: `${photo.file_unique_id}.jpg`,
            file_size: photo.file_size,
            mime_type: 'image/jpeg',
            width: photo.width,
            height: photo.height,
        });
    }
    if (msg.document) {
        const doc = msg.document;
        files.push({
            type: 'document',
            file_unique_id: doc.file_unique_id,
            file_id: doc.file_id,
            file_name: doc.file_name,
            file_size: doc.file_size,
            mime_type: doc.mime_type,
            width: doc.thumb?.width,
            height: doc.thumb?.height,
        });
    }
    return files;
}

// --- 타입이 강화된 Promise 기반 DB 헬퍼 --- //
type SQLiteParams = (string | number | null)[];

function dbRun(sql: string, params: SQLiteParams): Promise<void> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

function dbGet<T>(sql: string, params: SQLiteParams): Promise<T | null> {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err: Error | null, row: T) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
}

function dbAll<T>(sql: string, params: SQLiteParams): Promise<T[]> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err: Error | null, rows: T[]) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}
