let hasLikedVideo = false;
let hasDislikedVideo = false;
let isExtensionInitialized = false;
let videoResponse = null;

window.addEventListener('yt-navigate-finish', async () => await initialize(), true);
let initializer = setInterval(async () => await initialize(), 500);

async function initialize() {
    if (isExtensionInitialized || isVideoLoading()) {
        return;
    }

    console.log('Initializing open-youtube-dislikes...');
    await injectDislikes();
    hookLikeButton();
    hookDislikeButton();

    isExtensionInitialized = true;
    clearInterval(initializer);
}

async function injectDislikes() {
    console.log('Injecting dislikes');

    let payload = await buildVideoPayload();
    let videoID = extractVideoID();
    sendRequest('/video/' + videoID, 'POST', payload, function(xhr) {
        if (xhr.status != 200) {
            console.error('Failed to fetch video with status ' + xhr.status);
            return;
        }

        videoResponse = JSON.parse(xhr.response);
        
        hasDislikedVideo = videoResponse.hasDisliked;
        hasLikedVideo = videoResponse.hasLiked;

        setDislikeCount(videoResponse.formattedDislikes);
    });
}

function setDislikeCount(count) {
    const dislikeButtonTextPath = 'ytd-toggle-button-renderer.style-scope:nth-child(2) > a:nth-child(1) > yt-formatted-string:nth-child(2)';
    let dislikeButton = document.querySelector(dislikeButtonTextPath);
    if (!dislikeButton) {
        return;
    }

    dislikeButton.innerText = count;
}

function hookLikeButton() {
    console.log('Hooking like button');

    const likeButtonPath = 'ytd-toggle-button-renderer.style-scope:nth-child(1)';
    hookButton(likeButtonPath, function(e) {
        e.preventDefault();

        let videoID = extractVideoID();
        sendRequest('/video/' + videoID + '/like', 'POST', determineAction(hasLikedVideo), () => { });

        hasLikedVideo = !hasLikedVideo;
    });
}

function hookDislikeButton() {
    console.log('Hooking dislike button');

    const dislikeButtonPath = 'ytd-toggle-button-renderer.style-scope:nth-child(2)';
    hookButton(dislikeButtonPath, function(e) {
        e.preventDefault();

        let videoID = extractVideoID();
        sendRequest('/video/' + videoID + '/dislike', 'POST',  determineAction(hasDislikedVideo), () => { });

        hasDislikedVideo = !hasDislikedVideo;

        if (videoResponse.formattedDislikes.indexOf('K') > -1 ||videoResponse.formattedDislikes.indexOf('M') > -1) {
            return;
        }

        if (hasDislikedVideo) {
            videoResponse.dislikes++;
        } else {
            videoResponse.dislikes--;
        }

        videoResponse.formattedDislikes = '' + videoResponse.dislikes;
        setDislikeCount(videoResponse.formattedDislikes);
    });
}

function determineAction(bool) {
    return bool ? 'remove' : 'add';
}

function hookButton(buttonPath, callback) {
    let button = document.querySelector(buttonPath);
    if (!button) {
        return;
    }

    button.addEventListener('click', callback);
}

function sendRequest(endpoint, method, body, callback) {
    let url = getAPIUrl(endpoint);
    let userID = getUserID();
    console.debug('Submitting ' + method + ' request to ' + url + ' with body ' + JSON.stringify(body) + ' and user ID ' + userID);

    let xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-User-ID', userID);
    xhr.onload = function() {
        console.log(xhr.status);
        callback(xhr);  
    };
    xhr.send(JSON.stringify(body));
}

function isVideoLoading() {
    let videoID = extractVideoID();
    const videoPath = 'ytd-watch-flexy[video-id="' + videoID + '"]';
    return document.querySelector(videoPath) == null;
}

function getUserID() {
    const key = 'open_youtube_dislikes_user_id';
    let userID = localStorage.getItem(key);
    if (userID) {
        return userID;
    }

    let uuid = generateUUID();
    localStorage.setItem(key, uuid);
    return uuid;
}

// https://gist.github.com/jsmithdev/1f31f9f3912d40f6b60bdc7e8098ee9f
function generateUUID(){
    let dt = new Date().getTime()    
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (dt + Math.random()*16)%16 | 0
        dt = Math.floor(dt/16)
        return (c=='x' ? r :(r&0x3|0x8)).toString(16)
    })
    return uuid
}

function getAPIUrl(endpoint) {
    return 'https://gustavvy.com' + endpoint;
}

async function buildVideoPayload() {
    let videoID = extractVideoID();
    let hashedVideoID = await hashVideoID(videoID);
    let viewCount = extractViewCount();
    let likeCount = extractLikeCount();
    let commentCount = extractCommentCount();
    let subscriberCount = extractSubscriberCount();
    let publishedAt = extractPublishedAt();

    return {
        'id': videoID,
        'idHash': hashedVideoID,
        'views': viewCount,
        'likes': likeCount,
        'comments': commentCount,
        'subscribers': subscriberCount,
        'publishedAt': publishedAt
    };
}

async function hashVideoID(videoID) {
    const array = new TextEncoder().encode(videoID);
    let digest = await window.crypto.subtle.digest('SHA-256', array);
    return Array.from(new Uint8Array(digest), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function extractSubscriberCount() {
    const subscriberCountPath = '#owner-sub-count';
    let subscriberCount = document.querySelector(subscriberCountPath);
    if (!subscriberCount) {
        return -1;
    }

    let subscriberCountString = subscriberCount.getAttribute('aria-label').toLowerCase();

    let modifier = 1;
    if (subscriberCountString.indexOf('k') > -1) {
        modifier = 1000;
    }

    if (subscriberCountString.indexOf('million') > -1) {
        modifier = 1000000;
    }

    let count = Number(subscriberCountString.replace(/[milonksubcre]/g, ''));
    return count * modifier;
}

function extractCommentCount() {
    const commentCountPath = '.count-text > span:nth-child(1)';
    let commentCount = document.querySelector(commentCountPath);
    if (!commentCount) {
        return -1;
    }

    return Number(commentCount.innerText.replace(/,/g, ''));
}

function extractPublishedAt() {
    const publishedDatePath = 'yt-formatted-string.ytd-video-primary-info-renderer:nth-child(2)';
    let publishedDate = document.querySelector(publishedDatePath);
    if (!publishedDate) {
        return null;
    }

    // Parse date format "Dec 10, 2020"
    let dateString = publishedDate.innerText;
    let date = new Date(dateString);

    // Convert date to millis
    return date.getTime();
}

function extractLikeCount() {
    const likeCountPath = 'ytd-toggle-button-renderer.style-scope:nth-child(1) > a:nth-child(1) > yt-formatted-string:nth-child(2)';
    let likeCount = document.querySelector(likeCountPath);
    if (!likeCount) {
        return -1;
    }

    let likeCountString = likeCount.getAttribute('aria-label');
    let likesIndex = likeCountString.indexOf(' likes');
    if (likesIndex > -1) {
        likeCountString = likeCountString.substring(0, likesIndex);
    }

    return Number(likeCountString.replace(/,/g, ''));
}

function extractViewCount() {
    const viewCountPath = '.view-count';
    let viewCount = document.querySelector(viewCountPath);
    if (!viewCount) {
        return -1;
    }

    let viewCountString = viewCount.innerText;
    let viewsIndex = viewCountString.indexOf(' views');
    if (viewsIndex > -1) {
        viewCountString = viewCountString.substring(0, viewsIndex);
    }

    return Number(viewCountString.replace(/,/g, ''));
}

function extractVideoID() {
    let url = window.location.href;
    if (url.indexOf('?v=') === -1) {
        return null;
    }

    let videoID = url.split('?v=')[1];
    if (videoID.indexOf('&') > -1) {
        videoID = videoID.split('&')[0];
    }

    return videoID;
}