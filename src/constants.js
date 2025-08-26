const MessageTypes = {
    TEXT: 'text',
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    STICKER: 'sticker',
    REACTION: 'reaction',
    TYPING: 'typing',
    READ: 'read'
};

const MediaTypes = {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    STICKER: 'sticker'
};

const Endpoints = {
    LOGIN: 'https://www.facebook.com/login/device-based/regular/login/',
    MESSAGES: 'https://www.facebook.com/messaging/send/',
    THREADS: 'https://www.facebook.com/messaging/threads/',
    UPLOAD: 'https://upload.facebook.com/ajax/mercury/upload.php',
    GRAPHQL: 'https://www.facebook.com/api/graphql/',
    WEBSOCKET: 'wss://edge-chat.facebook.com/chat'
};

const UserAgents = {
    MOBILE: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
    DESKTOP: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

module.exports = {
    MessageTypes,
    MediaTypes,
    Endpoints,
    UserAgents
};