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
    MEDIA: 'https://www.facebook.com/messaging/send/',
    THREADS: 'https://www.facebook.com/messaging/thread_info/',
    USER_INFO: 'https://www.facebook.com/profile.php',
    SEARCH: 'https://www.facebook.com/search/people/',
    FRIENDS: 'https://www.facebook.com/friends/center/friends/'
};

const Headers = {
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ACCEPT: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    ACCEPT_LANGUAGE: 'en-US,en;q=0.5',
    ACCEPT_ENCODING: 'gzip, deflate, br',
    CONNECTION: 'keep-alive',
    UPGRADE_INSECURE_REQUESTS: '1'
};

module.exports = {
    MessageTypes,
    MediaTypes,
    Endpoints,
    Headers
};