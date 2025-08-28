const imageCache = new Map();
const CACHE_MAX_SIZE = 100;

const mimeMap = {
    'pdf': 'application/pdf',
    'py': 'text/x-python',
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'java': 'text/x-java-source',
    'c': 'text/x-c',
    'cpp': 'text/x-c++',
    'cs': 'text/x-csharp',
    'swift': 'text/x-swift',
    'php': 'text/x-php',
    'rb': 'text/x-ruby',
    'kt': 'text/x-kotlin',
    'go': 'text/x-go',
    'rs': 'text/rust',
    'html': 'text/html',
    'css': 'text/css',
};

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

export async function getFileBuffer(bot, fileId) {
    if (imageCache.has(fileId)) {
        return imageCache.get(fileId);
    }
    const fileStream = bot.getFileStream(fileId);
    const buffer = await streamToBuffer(fileStream);
    if (imageCache.size >= CACHE_MAX_SIZE) {
        const oldestKey = imageCache.keys().next().value;
        imageCache.delete(oldestKey);
    }
    imageCache.set(fileId, buffer);
    return buffer;
}

function getMimeType(fileName = '') {
    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png')) return 'image/jpeg';
    const extension = fileName.split('.').pop()?.toLowerCase();
    return mimeMap[extension] || 'application/octet-stream';
}

async function createFileParts(bot, files) {
    if (!files || files.length === 0) {
        return [];
    }
    return Promise.all(files.map(async (file) => {
        const buffer = await getFileBuffer(bot, file.file_id);
        const mimeType = getMimeType(file.file_name);
        return { inlineData: { data: buffer.toString('base64'), mimeType } };
    }));
}

// 대화 기록과 현재 메시지(앨범 포함)를 기반으로 API에 보낼 contents 배열을 생성
export async function buildContents(bot, conversationHistory, commandMsg, albumMessages, commandName) {
    let totalSize = 0;
    let contents = await Promise.all(
        conversationHistory.map(async (turn) => {
            turn.files.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, turn.files);
            const parts = [...fileParts];
            const commandRegex = new RegExp(`^/${commandName}(?:@\\w+bot)?\\s*`);
            const cleanText = turn.text.replace(commandRegex, '').trim();
            if (cleanText) parts.push({ text: cleanText });
            return { role: turn.role, parts };
        })
    );

    const allMessages = [commandMsg, ...albumMessages];
    if (allMessages.length > 0 && contents.length > 0) {
        const historyFileIds = new Set(conversationHistory.flatMap(turn => turn.files.map(f => f.file_id)));
        const currentFiles = allMessages
            .flatMap(m => (m.photo ? [{...m.photo[m.photo.length - 1], file_name: 'image.jpg'}] : (m.document ? [m.document] : [])))
            .filter(f => f && !historyFileIds.has(f.file_id));

        if (currentFiles.length > 0) {
            currentFiles.forEach(file => totalSize += file.file_size || 0);
            const fileParts = await createFileParts(bot, currentFiles);
            contents[contents.length - 1].parts.unshift(...fileParts);
        }
    }
    return { contents, totalSize };
}

export async function sendLongMessage(bot, chatId, text, replyToId) {
    const MAX_LENGTH = 4096;
    if (text.length <= MAX_LENGTH) {
        return bot.sendMessage(chatId, text, { reply_to_message_id: replyToId, parse_mode: 'HTML' });
    }

    const chunks = [];
    let currentChunk = "";
    let inPreBlock = false;
    const lines = text.split('\n');

    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
            if (inPreBlock) {
                currentChunk += '\n</pre>';
            }
            chunks.push(currentChunk);
            currentChunk = inPreBlock ? '<pre>' : '';
        }

        if (line.includes('<pre>')) inPreBlock = true;

        currentChunk += line + '\n';

        if (line.includes('</pre>')) inPreBlock = false;
    }

    if (currentChunk) {
        chunks.push(currentChunk);
    }

    let currentReplyToId = replyToId;
    let lastSentMessage = null;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const sentMsg = await bot.sendMessage(chatId, chunk, {
            reply_to_message_id: currentReplyToId,
            parse_mode: 'HTML'
        });
        currentReplyToId = sentMsg.message_id; // 다음 메시지는 방금 보낸 메시지에 답장
        lastSentMessage = sentMsg;
    }
    return lastSentMessage;
}