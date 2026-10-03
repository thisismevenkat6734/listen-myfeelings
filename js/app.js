/*
 * ============================================================
 * LISTEN MY FEELINGS
 * js/app.js
 * ============================================================
 *
 * Main authenticated application controller.
 *
 * Production responsibilities:
 *
 * - Firebase Authentication state
 * - Firestore feelings feed
 * - Feeling creation
 * - Search
 * - Feed filtering
 * - I Understand reactions
 * - Response creation
 * - Reporting
 * - Blocking
 * - Local draft saving
 * - User interface state
 * - Application navigation
 * - Logout
 *
 * Security:
 *
 * - Passwords are never handled here.
 * - Firebase Auth manages authentication.
 * - Firestore Security Rules remain authoritative.
 * - Local Storage is NEVER trusted for permissions.
 * - Connection access is NEVER unlocked locally.
 * - Rewarded-ad completion must be verified by a trusted
 *   backend before a connection document is created.
 *
 * Firebase:
 * Firebase SDK version is pinned to 12.2.1.
 * ============================================================
 */

import {
    auth,
    db
} from "../firebase/firebase-config.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    doc,
    setDoc,
    deleteDoc,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";


/* ============================================================
   CONFIGURATION
============================================================ */

const CONFIG = {

    firebaseSdkVersion:
        "12.2.1",

    maxFeelingLength:
        2000,

    maxResponseLength:
        2000,

    maxReportLength:
        1000,

    feedLimit:
        30,

    reactionBatchSize:
        30,

    draftKey:
        "lmf_feeling_draft",

    responseDraftKey:
        "lmf_response_draft",

    connectionUnlockDurationHours:
        12
};


/* ============================================================
   APPLICATION STATE
============================================================ */

const state = {

    user:
        null,

    feelings:
        [],

    understood:
        new Set(),

    search:
        "",

    filter:
        "latest",

    unsubscribeFeed:
        null,

    reactionLoading:
        new Set(),

    actionLoading:
        new Set(),

    responseTarget:
        null
};


/* ============================================================
   DOM REFERENCES
============================================================ */

const dom = {

    feed:
        document.getElementById(
            "feed-list"
        ),

    input:
        document.getElementById(
            "feeling-input"
        ),

    mood:
        document.getElementById(
            "feeling-mood"
        ),

    topic:
        document.getElementById(
            "feeling-topic"
        ),

    publish:
        document.getElementById(
            "publish-feeling"
        ),

    count:
        document.getElementById(
            "character-count"
        ),

    search:
        document.getElementById(
            "feed-search"
        ),

    filter:
        document.getElementById(
            "feed-filter"
        ),

    avatar:
        document.getElementById(
            "composer-avatar"
        ),

    logout:
        document.getElementById(
            "logout-button"
        )
};


/* ============================================================
   SAFE HTML
============================================================ */

function escapeHTML(value) {

    return String(value ?? "")
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/* ============================================================
   NORMALIZE TEXT
============================================================ */

function normalizeText(value) {

    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}


/* ============================================================
   TOAST
============================================================ */

function toast(
    message,
    type = "info"
) {

    if (
        window.ListenMyFeelings &&
        typeof window.ListenMyFeelings.showToast ===
            "function"
    ) {

        window.ListenMyFeelings.showToast(
            message,
            type
        );

        return;
    }

    /*
     * app.html may not contain the landing-page
     * toast controller.
     *
     * Therefore we provide a small application
     * toast fallback.
     */

    let toastElement =
        document.getElementById(
            "app-toast"
        );

    if (!toastElement) {

        toastElement =
            document.createElement(
                "div"
            );

        toastElement.id =
            "app-toast";

        toastElement.setAttribute(
            "role",
            "status"
        );

        toastElement.style.position =
            "fixed";

        toastElement.style.left =
            "50%";

        toastElement.style.bottom =
            "90px";

        toastElement.style.transform =
            "translateX(-50%) translateY(20px)";

        toastElement.style.zIndex =
            "99999";

        toastElement.style.maxWidth =
            "calc(100vw - 32px)";

        toastElement.style.padding =
            "12px 18px";

        toastElement.style.borderRadius =
            "14px";

        toastElement.style.background =
            "rgba(20,18,30,.96)";

        toastElement.style.border =
            "1px solid rgba(255,255,255,.12)";

        toastElement.style.color =
            "#fff";

        toastElement.style.fontSize =
            "14px";

        toastElement.style.boxShadow =
            "0 15px 45px rgba(0,0,0,.35)";

        toastElement.style.opacity =
            "0";

        toastElement.style.pointerEvents =
            "none";

        toastElement.style.transition =
            "opacity .2s ease, transform .2s ease";

        document.body.appendChild(
            toastElement
        );
    }

    toastElement.textContent =
        message;

    toastElement.dataset.type =
        type;

    toastElement.style.opacity =
        "1";

    toastElement.style.transform =
        "translateX(-50%) translateY(0)";

    clearTimeout(
        toastElement._hideTimer
    );

    toastElement._hideTimer =
        setTimeout(
            () => {

                toastElement.style.opacity =
                    "0";

                toastElement.style.transform =
                    "translateX(-50%) translateY(20px)";
            },
            3000
        );
}


/* ============================================================
   USER INITIAL
============================================================ */

function getInitial(
    user
) {

    const value =
        user?.displayName ||
        user?.email ||
        "U";

    return value
        .trim()
        .charAt(0)
        .toUpperCase();
}


/* ============================================================
   TIME FORMAT
============================================================ */

function formatTime(
    timestamp
) {

    if (!timestamp) {
        return "Just now";
    }

    try {

        const date =
            typeof timestamp.toDate ===
            "function"

                ? timestamp.toDate()

                : new Date(timestamp);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            return "Recently";
        }

        const difference =
            Date.now() -
            date.getTime();

        if (difference < 0) {
            return "Just now";
        }

        const minutes =
            Math.floor(
                difference / 60000
            );

        if (minutes < 1) {
            return "Just now";
        }

        if (minutes < 60) {
            return `${minutes}m`;
        }

        const hours =
            Math.floor(
                minutes / 60
            );

        if (hours < 24) {
            return `${hours}h`;
        }

        const days =
            Math.floor(
                hours / 24
            );

        if (days < 7) {
            return `${days}d`;
        }

        return date.toLocaleDateString();

    } catch {

        return "Recently";
    }
}


/* ============================================================
   FIRESTORE ERROR MESSAGE
============================================================ */

function getFirestoreErrorMessage(
    error
) {

    const code =
        error?.code || "";

    const messages = {

        "permission-denied":
            "You don't have permission to perform this action.",

        "unauthenticated":
            "Please sign in again.",

        "failed-precondition":
            "This operation needs additional Firebase configuration.",

        "resource-exhausted":
            "The service is temporarily busy. Please try again later.",

        "unavailable":
            "The service is temporarily unavailable.",

        "network-request-failed":
            "Please check your internet connection."
    };

    return (
        messages[code] ||
        "Something went wrong. Please try again."
    );
}


/* ============================================================
   AUTHENTICATION
============================================================ */

function initializeAuthentication() {

    onAuthStateChanged(
        auth,
        async (user) => {

            state.user =
                user;

            if (!user) {

                stopFeed();

                window.location.replace(
                    "index.html"
                );

                return;
            }

            updateUserUI(
                user
            );

            restoreDraft();

            initializeReactionState();

            startFeed();
        }
    );
}


/* ============================================================
   USER UI
============================================================ */

function updateUserUI(
    user
) {

    if (dom.avatar) {

        dom.avatar.textContent =
            getInitial(user);
    }

    document
        .querySelectorAll(
            "[data-user-name]"
        )
        .forEach(
            (element) => {

                element.textContent =
                    user.displayName ||
                    user.email
                        ?.split("@")[0] ||
                    "Listener";
            }
        );

    document
        .querySelectorAll(
            "[data-user-email]"
        )
        .forEach(
            (element) => {

                element.textContent =
                    user.email || "";
            }
        );

    document
        .querySelectorAll(
            "[data-user-initial]"
        )
        .forEach(
            (element) => {

                element.textContent =
                    getInitial(user);
            }
        );
}


/* ============================================================
   REACTION STATE
============================================================ */

async function initializeReactionState() {

    state.understood.clear();

    if (!state.user) {
        return;
    }

    /*
     * Load the user's own reaction documents for
     * the current feed.
     *
     * We intentionally do not trust understoodCount
     * as proof that the current user reacted.
     */

    if (!state.feelings.length) {
        return;
    }

    await loadReactionState();
}


async function loadReactionState() {

    if (!state.user) {
        return;
    }

    try {

        const feelings =
            state.feelings.slice(
                0,
                CONFIG.reactionBatchSize
            );

        const results =
            await Promise.all(
                feelings.map(
                    async (feeling) => {

                        const reactionRef =
                            doc(
                                db,
                                "feelings",
                                feeling.id,
                                "understands",
                                state.user.uid
                            );

                        try {

                            const snapshot =
                                await getDocs(
                                    query(
                                        collection(
                                            reactionRef.parent
                                        ),
                                        where(
                                            "userId",
                                            "==",
                                            state.user.uid
                                        ),
                                        limit(1)
                                    )
                                );

                            return {
                                id:
                                    feeling.id,

                                exists:
                                    !snapshot.empty
                            };

                        } catch {

                            return {
                                id:
                                    feeling.id,

                                exists:
                                    false
                            };
                        }
                    }
                )
            );

        results.forEach(
            (result) => {

                if (result.exists) {

                    state.understood.add(
                        result.id
                    );
                }
            }
        );

        renderFeed();

    } catch (error) {

        console.warn(
            "Reaction state load failed:",
            error
        );
    }
}


/* ============================================================
   FEED START
============================================================ */

function startFeed() {

    stopFeed();

    if (!dom.feed) {
        return;
    }

    dom.feed.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">◌</div>

            <h3>
                Loading feelings...
            </h3>

            <p>
                Finding something worth listening to.
            </p>
        </div>
    `;

    const feelingsCollection =
        collection(
            db,
            "feelings"
        );

    const feedQuery =
        query(
            feelingsCollection,

            where(
                "visibility",
                "==",
                "public"
            ),

            where(
                "status",
                "==",
                "active"
            ),

            orderBy(
                "createdAt",
                "desc"
            ),

            limit(
                CONFIG.feedLimit
            )
        );

    state.unsubscribeFeed =
        onSnapshot(
            feedQuery,

            async (snapshot) => {

                state.feelings =
                    snapshot.docs.map(
                        (document) => ({
                            id:
                                document.id,

                            ...document.data()
                        })
                    );

                renderFeed();

                await loadReactionState();
            },

            (error) => {

                console.error(
                    "Feed listener error:",
                    error
                );

                renderFeedError(
                    error
                );
            }
        );
}


/* ============================================================
   STOP FEED
============================================================ */

function stopFeed() {

    if (
        typeof state.unsubscribeFeed ===
        "function"
    ) {

        state.unsubscribeFeed();

        state.unsubscribeFeed =
            null;
    }
}


/* ============================================================
   FEED ERROR
============================================================ */

function renderFeedError(
    error
) {

    if (!dom.feed) {
        return;
    }

    const message =
        getFirestoreErrorMessage(
            error
        );

    dom.feed.innerHTML = `
        <div class="empty-state">

            <div class="empty-icon">
                !
            </div>

            <h3>
                Feed couldn't load
            </h3>

            <p>
                ${escapeHTML(message)}
            </p>

            <button
                type="button"
                class="feeling-action"
                data-refresh-feed
            >
                Try again
            </button>

        </div>
    `;

    const refreshButton =
        dom.feed.querySelector(
            "[data-refresh-feed]"
        );

    if (refreshButton) {

        refreshButton.addEventListener(
            "click",
            startFeed
        );
    }
}


/* ============================================================
   FILTER FEELINGS
============================================================ */

function getFilteredFeelings() {

    let feelings =
        [...state.feelings];

    const search =
        state.search
            .trim()
            .toLowerCase();

    if (search) {

        feelings =
            feelings.filter(
                (feeling) => {

                    const text =
                        String(
                            feeling.text ||
                            ""
                        ).toLowerCase();

                    const mood =
                        String(
                            feeling.mood ||
                            ""
                        ).toLowerCase();

                    const topic =
                        String(
                            feeling.topic ||
                            ""
                        ).toLowerCase();

                    const author =
                        String(
                            feeling.authorDisplayName ||
                            ""
                        ).toLowerCase();

                    return (
                        text.includes(
                            search
                        ) ||
                        mood.includes(
                            search
                        ) ||
                        topic.includes(
                            search
                        ) ||
                        author.includes(
                            search
                        )
                    );
                }
            );
    }

    if (
        state.filter ===
        "understood"
    ) {

        feelings.sort(
            (a, b) =>
                Number(
                    b.understoodCount ||
                    0
                ) -
                Number(
                    a.understoodCount ||
                    0
                )
        );
    }

    if (
        state.filter ===
        "oldest"
    ) {

        feelings.sort(
            (a, b) => {

                const aTime =
                    a.createdAt?.toMillis?.() ||
                    0;

                const bTime =
                    b.createdAt?.toMillis?.() ||
                    0;

                return (
                    aTime -
                    bTime
                );
            }
        );
    }

    return feelings;
}


/* ============================================================
   RENDER FEED
============================================================ */

function renderFeed() {

    if (!dom.feed) {
        return;
    }

    const feelings =
        getFilteredFeelings();

    if (!feelings.length) {

        dom.feed.innerHTML = `
            <div class="empty-state">

                <div class="empty-icon">
                    ♡
                </div>

                <h3>
                    No feelings found
                </h3>

                <p>
                    Be the first person to share
                    something real.
                </p>

            </div>
        `;

        return;
    }

    dom.feed.innerHTML =
        feelings
            .map(
                createFeelingCard
            )
            .join("");

    bindFeedActions();
}


/* ============================================================
   FEELING CARD
============================================================ */

function createFeelingCard(
    feeling
) {

    const author =
        normalizeText(
            feeling.authorDisplayName
        ) ||
        "Listener";

    const initial =
        escapeHTML(
            author
                .charAt(0)
                .toUpperCase()
        );

    const text =
        escapeHTML(
            feeling.text || ""
        );

    const mood =
        feeling.mood
            ? `
                <span class="feeling-tag">
                    ${escapeHTML(
                        feeling.mood
                    )}
                </span>
              `
            : "";

    const topic =
        feeling.topic
            ? `
                <span class="feeling-tag">
                    ${escapeHTML(
                        feeling.topic
                    )}
                </span>
              `
            : "";

    const understoodCount =
        Math.max(
            0,
            Number(
                feeling.understoodCount ||
                0
            )
        );

    const alreadyUnderstood =
        state.understood.has(
            feeling.id
        );

    const isOwn =
        state.user?.uid ===
        feeling.authorId;

    const reactionBusy =
        state.reactionLoading.has(
            feeling.id
        );

    return `
        <article
            class="feeling-card"
            data-feeling-id="${escapeHTML(
                feeling.id
            )}"
        >

            <div class="feeling-head">

                <div class="person">

                    <div
                        class="avatar"
                        aria-hidden="true"
                    >
                        ${initial}
                    </div>

                    <div class="person-info">

                        <strong>
                            ${escapeHTML(
                                author
                            )}
                        </strong>

                        <small>
                            ${escapeHTML(
                                formatTime(
                                    feeling.createdAt
                                )
                            )}
                        </small>

                    </div>

                </div>

                <button
                    class="more-btn"
                    type="button"
                    data-report-id="${escapeHTML(
                        feeling.id
                    )}"
                    aria-label="Report this feeling"
                >
                    •••
                </button>

            </div>


            <div class="feeling-text">
                ${text}
            </div>


            ${
                mood || topic
                    ? `
                        <div class="feeling-tags">
                            ${mood}
                            ${topic}
                        </div>
                      `
                    : ""
            }


            <div class="feeling-actions">

                <button
                    class="feeling-action ${
                        alreadyUnderstood
                            ? "understood"
                            : ""
                    }"
                    type="button"
                    data-understand-id="${escapeHTML(
                        feeling.id
                    )}"
                    ${
                        reactionBusy
                            ? "disabled"
                            : ""
                    }
                    aria-pressed="${
                        alreadyUnderstood
                    }"
                >
                    ${
                        alreadyUnderstood
                            ? "♥ I Understand"
                            : "♡ I Understand"
                    }

                    ${
                        understoodCount > 0
                            ? ` · ${understoodCount}`
                            : ""
                    }
                </button>


                <button
                    class="feeling-action"
                    type="button"
                    data-respond-id="${escapeHTML(
                        feeling.id
                    )}"
                >
                    💬 Respond
                </button>


                <button
                    class="feeling-action"
                    type="button"
                    data-connect-id="${escapeHTML(
                        feeling.authorId ||
                        ""
                    )}"
                    ${
                        isOwn
                            ? "disabled"
                            : ""
                    }
                >
                    🤝 Connect
                </button>

            </div>

        </article>
    `;
}


/* ============================================================
   FEED ACTION BINDING
============================================================ */

function bindFeedActions() {

    document
        .querySelectorAll(
            "[data-understand-id]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        toggleUnderstand(
                            button.dataset
                                .understandId
                        );
                    }
                );
            }
        );


    document
        .querySelectorAll(
            "[data-respond-id]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        openResponseComposer(
                            button.dataset
                                .respondId
                        );
                    }
                );
            }
        );


    document
        .querySelectorAll(
            "[data-connect-id]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        requestConnection(
                            button.dataset
                                .connectId
                        );
                    }
                );
            }
        );


    document
        .querySelectorAll(
            "[data-report-id]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        openSafetyMenu(
                            button.dataset
                                .reportId
                        );
                    }
                );
            }
        );
}


/* ============================================================
   I UNDERSTAND
============================================================ */

async function toggleUnderstand(
    feelingId
) {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    if (!feelingId) {
        return;
    }

    if (
        state.reactionLoading.has(
            feelingId
        )
    ) {
        return;
    }

    state.reactionLoading.add(
        feelingId
    );

    renderFeed();

    const reactionRef =
        doc(
            db,
            "feelings",
            feelingId,
            "understands",
            state.user.uid
        );

    const alreadyUnderstood =
        state.understood.has(
            feelingId
        );

    try {

        if (alreadyUnderstood) {

            await deleteDoc(
                reactionRef
            );

            state.understood.delete(
                feelingId
            );

        } else {

            await setDoc(
                reactionRef,
                {
                    userId:
                        state.user.uid,

                    createdAt:
                        serverTimestamp()
                }
            );

            state.understood.add(
                feelingId
            );
        }

        toast(
            alreadyUnderstood
                ? "I Understand removed."
                : "I Understand sent.",
            "success"
        );

    } catch (error) {

        console.error(
            "I Understand error:",
            error
        );

        toast(
            getFirestoreErrorMessage(
                error
            ),
            "error"
        );

    } finally {

        state.reactionLoading.delete(
            feelingId
        );

        renderFeed();
    }
}


/* ============================================================
   CREATE FEELING
============================================================ */

async function createFeeling() {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    const text =
        normalizeText(
            dom.input?.value
        );

    const mood =
        normalizeText(
            dom.mood?.value
        );

    const topic =
        normalizeText(
            dom.topic?.value
        );

    if (!text) {

        toast(
            "Write something before sharing.",
            "error"
        );

        dom.input?.focus();

        return;
    }

    if (
        text.length >
        CONFIG.maxFeelingLength
    ) {

        toast(
            `Your feeling can contain up to ${CONFIG.maxFeelingLength} characters.`,
            "error"
        );

        return;
    }

    if (
        state.actionLoading.has(
            "publish"
        )
    ) {
        return;
    }

    state.actionLoading.add(
        "publish"
    );

    setPublishLoading(
        true
    );

    try {

        await addDoc(
            collection(
                db,
                "feelings"
            ),
            {

                authorId:
                    state.user.uid,

                authorDisplayName:
                    state.user.displayName ||
                    state.user.email
                        ?.split("@")[0] ||
                    "Listener",

                text,

                mood,

                topic,

                visibility:
                    "public",

                status:
                    "active",

                understoodCount:
                    0,

                createdAt:
                    serverTimestamp(),

                updatedAt:
                    serverTimestamp()
            }
        );

        clearDraft();

        if (dom.input) {
            dom.input.value =
                "";
        }

        if (dom.mood) {
            dom.mood.value =
                "";
        }

        if (dom.topic) {
            dom.topic.value =
                "";
        }

        updateCharacterCount();

        toast(
            "Your feeling has been shared.",
            "success"
        );

    } catch (error) {

        console.error(
            "Create feeling error:",
            error
        );

        toast(
            getFirestoreErrorMessage(
                error
            ),
            "error"
        );

    } finally {

        state.actionLoading.delete(
            "publish"
        );

        setPublishLoading(
            false
        );
    }
}


/* ============================================================
   PUBLISH BUTTON STATE
============================================================ */

function setPublishLoading(
    loading
) {

    if (!dom.publish) {
        return;
    }

    dom.publish.disabled =
        loading;

    if (loading) {

        if (
            !dom.publish.dataset.originalLabel
        ) {

            dom.publish.dataset.originalLabel =
                dom.publish.textContent;
        }

        dom.publish.textContent =
            "Sharing...";

    } else {

        dom.publish.textContent =
            dom.publish.dataset.originalLabel ||
            "Share feeling";
    }
}


/* ============================================================
   CHARACTER COUNT
============================================================ */

function updateCharacterCount() {

    if (
        !dom.input ||
        !dom.count
    ) {
        return;
    }

    dom.count.textContent =
        `${dom.input.value.length} / ${CONFIG.maxFeelingLength}`;

    dom.count.setAttribute(
        "aria-live",
        "polite"
    );
}


/* ============================================================
   RESPONSE MODAL
============================================================ */

function openResponseComposer(
    feelingId
) {

    const feeling =
        state.feelings.find(
            item =>
                item.id ===
                feelingId
        );

    if (!feeling) {
        return;
    }

    state.responseTarget =
        feeling;

    const modal =
        getOrCreateModal(
            "response-modal"
        );

    modal.innerHTML = `
        <div
            class="lmf-modal-backdrop"
            data-close-modal
        ></div>

        <div
            class="lmf-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="response-modal-title"
        >

            <button
                type="button"
                class="lmf-modal-close"
                data-close-modal
                aria-label="Close"
            >
                ×
            </button>

            <h2 id="response-modal-title">
                Respond thoughtfully
            </h2>

            <p class="lmf-modal-subtitle">
                ${escapeHTML(
                    truncateText(
                        feeling.text,
                        180
                    )
                )}
            </p>

            <textarea
                id="lmf-response-input"
                maxlength="${CONFIG.maxResponseLength}"
                rows="6"
                placeholder="Write something kind, thoughtful and genuine..."
            ></textarea>

            <div class="lmf-modal-footer">

                <span id="lmf-response-count">
                    0 / ${CONFIG.maxResponseLength}
                </span>

                <button
                    type="button"
                    class="lmf-modal-primary"
                    id="lmf-send-response"
                >
                    Send response
                </button>

            </div>

        </div>
    `;

    showModal(
        modal
    );

    const input =
        document.getElementById(
            "lmf-response-input"
        );

    const count =
        document.getElementById(
            "lmf-response-count"
        );

    const send =
        document.getElementById(
            "lmf-send-response"
        );

    restoreResponseDraft(
        input,
        feelingId
    );

    if (input) {

        input.addEventListener(
            "input",
            () => {

                if (count) {

                    count.textContent =
                        `${input.value.length} / ${CONFIG.maxResponseLength}`;
                }

                saveResponseDraft(
                    feelingId,
                    input.value
                );
            }
        );

        setTimeout(
            () => input.focus(),
            50
        );
    }

    if (send) {

        send.addEventListener(
            "click",
            () => {

                createResponse(
                    feelingId,
                    input,
                    send
                );
            }
        );
    }

    modal
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(
            (element) => {

                element.addEventListener(
                    "click",
                    () => {

                        closeModal(
                            modal
                        );
                    }
                );
            }
        );
}


/* ============================================================
   CREATE RESPONSE
============================================================ */

async function createResponse(
    feelingId,
    input,
    button
) {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    const text =
        normalizeText(
            input?.value
        );

    if (!text) {

        toast(
            "Write a response first.",
            "error"
        );

        input?.focus();

        return;
    }

    if (
        text.length >
        CONFIG.maxResponseLength
    ) {

        toast(
            `Your response can contain up to ${CONFIG.maxResponseLength} characters.`,
            "error"
        );

        return;
    }

    if (
        state.actionLoading.has(
            `response:${feelingId}`
        )
    ) {
        return;
    }

    state.actionLoading.add(
        `response:${feelingId}`
    );

    if (button) {

        button.disabled =
            true;

        button.textContent =
            "Sending...";
    }

    try {

        await addDoc(
            collection(
                db,
                "feelings",
                feelingId,
                "responses"
            ),
            {

                authorId:
                    state.user.uid,

                authorDisplayName:
                    state.user.displayName ||
                    state.user.email
                        ?.split("@")[0] ||
                    "Listener",

                text,

                status:
                    "active",

                createdAt:
                    serverTimestamp(),

                updatedAt:
                    serverTimestamp()
            }
        );

        clearResponseDraft(
            feelingId
        );

        const modal =
            document.getElementById(
                "response-modal"
            );

        closeModal(
            modal
        );

        toast(
            "Your response has been sent.",
            "success"
        );

    } catch (error) {

        console.error(
            "Response error:",
            error
        );

        toast(
            getFirestoreErrorMessage(
                error
            ),
            "error"
        );

        if (button) {

            button.disabled =
                false;

            button.textContent =
                "Send response";
        }

    } finally {

        state.actionLoading.delete(
            `response:${feelingId}`
        );
    }
}


/* ============================================================
   CONNECTION REQUEST
============================================================ */

function requestConnection(
    userId
) {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    if (!userId) {
        return;
    }

    if (
        userId ===
        state.user.uid
    ) {

        toast(
            "You cannot connect with yourself.",
            "error"
        );

        return;
    }

    /*
     * SECURITY IMPORTANT
     *
     * We DO NOT create a connection document here.
     *
     * The final V1 connection flow is:
     *
     * User taps Connect
     *        ↓
     * Rewarded advertisement
     *        ↓
     * Ad provider verification
     *        ↓
     * Trusted backend
     *        ↓
     * adUnlocks document
     *        ↓
     * connection document
     *        ↓
     * 12-hour server controlled expiry
     *
     * Therefore browser Local Storage, JavaScript time,
     * URL parameters or Firebase client code cannot unlock
     * a connection by themselves.
     */

    openConnectionInformation(
        userId
    );
}


/* ============================================================
   CONNECTION INFORMATION
============================================================ */

function openConnectionInformation(
    userId
) {

    const modal =
        getOrCreateModal(
            "connection-modal"
        );

    modal.innerHTML = `
        <div
            class="lmf-modal-backdrop"
            data-close-modal
        ></div>

        <div
            class="lmf-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-modal-title"
        >

            <button
                type="button"
                class="lmf-modal-close"
                data-close-modal
                aria-label="Close"
            >
                ×
            </button>

            <div class="lmf-modal-icon">
                🤝
            </div>

            <h2 id="connection-modal-title">
                Connect meaningfully
            </h2>

            <p>
                Connections are unlocked through a
                verified rewarded-ad flow.
            </p>

            <div class="lmf-info-box">

                <strong>
                    12-hour connection access
                </strong>

                <span>
                    After successful server verification,
                    the connection remains active for
                    12 hours.
                </span>

            </div>

            <p class="lmf-modal-note">
                Watching an advertisement is not enough
                by itself. The ad provider's completion
                must be verified by our trusted backend.
            </p>

            <button
                type="button"
                class="lmf-modal-primary"
                id="lmf-start-connection"
                data-user-id="${escapeHTML(
                    userId
                )}"
            >
                Continue
            </button>

        </div>
    `;

    showModal(
        modal
    );

    modal
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(
            (element) => {

                element.addEventListener(
                    "click",
                    () => {

                        closeModal(
                            modal
                        );
                    }
                );
            }
        );

    const button =
        document.getElementById(
            "lmf-start-connection"
        );

    if (button) {

        button.addEventListener(
            "click",
            () => {

                /*
                 * Backend/ad provider integration is deliberately
                 * not faked here.
                 */

                toast(
                    "Verified rewarded-ad connection flow will be activated when the ad backend is connected.",
                    "info"
                );
            }
        );
    }
}


/* ============================================================
   SAFETY MENU
============================================================ */

function openSafetyMenu(
    feelingId
) {

    const modal =
        getOrCreateModal(
            "safety-modal"
        );

    modal.innerHTML = `
        <div
            class="lmf-modal-backdrop"
            data-close-modal
        ></div>

        <div
            class="lmf-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="safety-modal-title"
        >

            <button
                type="button"
                class="lmf-modal-close"
                data-close-modal
                aria-label="Close"
            >
                ×
            </button>

            <h2 id="safety-modal-title">
                Safety & privacy
            </h2>

            <p>
                Help keep Listen My Feelings respectful
                and safe for everyone.
            </p>

            <div class="lmf-safety-actions">

                <button
                    type="button"
                    id="lmf-report-button"
                    class="lmf-danger-button"
                >
                    🚨 Report this feeling
                </button>

                <button
                    type="button"
                    id="lmf-block-button"
                    class="lmf-secondary-button"
                >
                    🚫 Block this person
                </button>

            </div>

        </div>
    `;

    showModal(
        modal
    );

    modal
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(
            (element) => {

                element.addEventListener(
                    "click",
                    () => {

                        closeModal(
                            modal
                        );
                    }
                );
            }
        );

    const reportButton =
        document.getElementById(
            "lmf-report-button"
        );

    const blockButton =
        document.getElementById(
            "lmf-block-button"
        );

    const feeling =
        state.feelings.find(
            item =>
                item.id ===
                feelingId
        );

    if (reportButton) {

        reportButton.addEventListener(
            "click",
            () => {

                closeModal(
                    modal
                );

                openReportComposer(
                    feelingId
                );
            }
        );
    }

    if (blockButton) {

        blockButton.addEventListener(
            "click",
            () => {

                closeModal(
                    modal
                );

                if (
                    feeling?.authorId
                ) {

                    blockUser(
                        feeling.authorId
                    );
                }
            }
        );
    }
}


/* ============================================================
   REPORT COMPOSER
============================================================ */

function openReportComposer(
    feelingId
) {

    const modal =
        getOrCreateModal(
            "report-modal"
        );

    modal.innerHTML = `
        <div
            class="lmf-modal-backdrop"
            data-close-modal
        ></div>

        <div
            class="lmf-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-modal-title"
        >

            <button
                type="button"
                class="lmf-modal-close"
                data-close-modal
                aria-label="Close"
            >
                ×
            </button>

            <h2 id="report-modal-title">
                Report feeling
            </h2>

            <p>
                Tell us why you are reporting this content.
            </p>

            <select id="lmf-report-reason">
                <option value="">
                    Select a reason
                </option>

                <option value="harassment">
                    Harassment or bullying
                </option>

                <option value="hate">
                    Hateful or abusive content
                </option>

                <option value="sexual">
                    Sexual or inappropriate content
                </option>

                <option value="self_harm">
                    Self-harm related concern
                </option>

                <option value="spam">
                    Spam or misleading content
                </option>

                <option value="privacy">
                    Privacy concern
                </option>

                <option value="other">
                    Other
                </option>
            </select>

            <textarea
                id="lmf-report-details"
                maxlength="${CONFIG.maxReportLength}"
                rows="5"
                placeholder="Optional additional details..."
            ></textarea>

            <button
                type="button"
                class="lmf-modal-primary"
                id="lmf-submit-report"
            >
                Submit report
            </button>

        </div>
    `;

    showModal(
        modal
    );

    modal
        .querySelectorAll(
            "[data-close-modal]"
        )
        .forEach(
            (element) => {

                element.addEventListener(
                    "click",
                    () => {

                        closeModal(
                            modal
                        );
                    }
                );
            }
        );

    const submit =
        document.getElementById(
            "lmf-submit-report"
        );

    if (submit) {

        submit.addEventListener(
            "click",
            () => {

                submitReport(
                    feelingId,
                    submit
                );
            }
        );
    }
}


/* ============================================================
   SUBMIT REPORT
============================================================ */

async function submitReport(
    feelingId,
    button
) {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    const reason =
        normalizeText(
            document.getElementById(
                "lmf-report-reason"
            )?.value
        );

    const details =
        normalizeText(
            document.getElementById(
                "lmf-report-details"
            )?.value
        );

    if (!reason) {

        toast(
            "Please select a report reason.",
            "error"
        );

        return;
    }

    if (
        details.length >
        CONFIG.maxReportLength
    ) {

        toast(
            `Report details can contain up to ${CONFIG.maxReportLength} characters.`,
            "error"
        );

        return;
    }

    if (
        state.actionLoading.has(
            `report:${feelingId}`
        )
    ) {
        return;
    }

    state.actionLoading.add(
        `report:${feelingId}`
    );

    if (button) {

        button.disabled =
            true;

        button.textContent =
            "Submitting...";
    }

    try {

        await addDoc(
            collection(
                db,
                "reports"
            ),
            {

                reporterId:
                    state.user.uid,

                targetType:
                    "feeling",

                targetId:
                    feelingId,

                reason,

                details,

                status:
                    "open",

                createdAt:
                    serverTimestamp()
            }
        );

        closeModal(
            document.getElementById(
                "report-modal"
            )
        );

        toast(
            "Thank you. Your report has been submitted.",
            "success"
        );

    } catch (error) {

        console.error(
            "Report error:",
            error
        );

        toast(
            getFirestoreErrorMessage(
                error
            ),
            "error"
        );

        if (button) {

            button.disabled =
                false;

            button.textContent =
                "Submit report";
        }

    } finally {

        state.actionLoading.delete(
            `report:${feelingId}`
        );
    }
}


/* ============================================================
   BLOCK USER
============================================================ */

async function blockUser(
    userId
) {

    if (!state.user) {

        toast(
            "Please sign in first.",
            "error"
        );

        return;
    }

    if (!userId) {
        return;
    }

    if (
        userId ===
        state.user.uid
    ) {

        toast(
            "You cannot block yourself.",
            "error"
        );

        return;
    }

    const confirmed =
        window.confirm(
            "Block this person? Their content should no longer be part of your experience."
        );

    if (!confirmed) {
        return;
    }

    const blockId =
        `${state.user.uid}_${userId}`;

    try {

        await setDoc(
            doc(
                db,
                "blocks",
                blockId
            ),
            {

                blockerId:
                    state.user.uid,

                blockedUserId:
                    userId,

                createdAt:
                    serverTimestamp()
            }
        );

        toast(
            "This person has been blocked.",
            "success"
        );

    } catch (error) {

        console.error(
            "Block error:",
            error
        );

        toast(
            getFirestoreErrorMessage(
                error
            ),
            "error"
        );
    }
}


/* ============================================================
   LOCAL DRAFT
============================================================ */

function saveDraft() {

    if (!dom.input) {
        return;
    }

    try {

        const draft = {

            text:
                dom.input.value,

            mood:
                dom.mood?.value ||
                "",

            topic:
                dom.topic?.value ||
                "",

            savedAt:
                Date.now()
        };

        localStorage.setItem(
            CONFIG.draftKey,
            JSON.stringify(
                draft
            )
        );

    } catch (error) {

        console.warn(
            "Draft save failed:",
            error
        );
    }
}


function restoreDraft() {

    try {

        const raw =
            localStorage.getItem(
                CONFIG.draftKey
            );

        if (!raw) {
            return;
        }

        const draft =
            JSON.parse(
                raw
            );

        if (!draft) {
            return;
        }

        if (
            dom.input &&
            typeof draft.text ===
            "string"
        ) {

            dom.input.value =
                draft.text;
        }

        if (
            dom.mood &&
            typeof draft.mood ===
            "string"
        ) {

            dom.mood.value =
                draft.mood;
        }

        if (
            dom.topic &&
            typeof draft.topic ===
            "string"
        ) {

            dom.topic.value =
                draft.topic;
        }

        updateCharacterCount();

    } catch (error) {

        console.warn(
            "Draft restore failed:",
            error
        );

        clearDraft();
    }
}


function clearDraft() {

    try {

        localStorage.removeItem(
            CONFIG.draftKey
        );

    } catch {
        /*
         * Local Storage is optional.
         */
    }
}


/* ============================================================
   RESPONSE DRAFT
============================================================ */

function responseDraftKey(
    feelingId
) {

    return `${CONFIG.responseDraftKey}_${feelingId}`;
}


function saveResponseDraft(
    feelingId,
    text
) {

    if (!feelingId) {
        return;
    }

    try {

        localStorage.setItem(
            responseDraftKey(
                feelingId
            ),
            JSON.stringify({
                text:
                    text || "",

                savedAt:
                    Date.now()
            })
        );

    } catch {
        /*
         * Optional local convenience state.
         */
    }
}


function restoreResponseDraft(
    input,
    feelingId
) {

    if (!input || !feelingId) {
        return;
    }

    try {

        const raw =
            localStorage.getItem(
                responseDraftKey(
                    feelingId
                )
            );

        if (!raw) {
            return;
        }

        const draft =
            JSON.parse(
                raw
            );

        if (
            draft &&
            typeof draft.text ===
            "string"
        ) {

            input.value =
                draft.text;

            const count =
                document.getElementById(
                    "lmf-response-count"
                );

            if (count) {

                count.textContent =
                    `${input.value.length} / ${CONFIG.maxResponseLength}`;
            }
        }

    } catch {
        /*
         * Ignore malformed optional draft.
         */
    }
}


function clearResponseDraft(
    feelingId
) {

    try {

        localStorage.removeItem(
            responseDraftKey(
                feelingId
            )
        );

    } catch {
        /*
         * Ignore storage errors.
         */
    }
}


/* ============================================================
   SEARCH
============================================================ */

function initializeSearch() {

    if (!dom.search) {
        return;
    }

    dom.search.addEventListener(
        "input",
        () => {

            state.search =
                dom.search.value;

            renderFeed();
        }
    );
}


/* ============================================================
   FILTER
============================================================ */

function initializeFilter() {

    if (!dom.filter) {
        return;
    }

    dom.filter.addEventListener(
        "change",
        () => {

            state.filter =
                dom.filter.value;

            renderFeed();
        }
    );
}


/* ============================================================
   COMPOSER
============================================================ */

function initializeComposer() {

    if (dom.publish) {

        dom.publish.addEventListener(
            "click",
            createFeeling
        );
    }

    if (dom.input) {

        dom.input.addEventListener(
            "input",
            () => {

                updateCharacterCount();

                saveDraft();
            }
        );
    }

    if (dom.mood) {

        dom.mood.addEventListener(
            "change",
            saveDraft
        );
    }

    if (dom.topic) {

        dom.topic.addEventListener(
            "change",
            saveDraft
        );
    }

    updateCharacterCount();
}


/* ============================================================
   LOGOUT
============================================================ */

function initializeLogout() {

    if (!dom.logout) {
        return;
    }

    dom.logout.addEventListener(
        "click",
        async () => {

            if (
                state.actionLoading.has(
                    "logout"
                )
            ) {
                return;
            }

            state.actionLoading.add(
                "logout"
            );

            dom.logout.disabled =
                true;

            try {

                await signOut(
                    auth
                );

                stopFeed();

                window.location.replace(
                    "index.html"
                );

            } catch (error) {

                console.error(
                    "Logout error:",
                    error
                );

                dom.logout.disabled =
                    false;

                state.actionLoading.delete(
                    "logout"
                );

                toast(
                    "Unable to log out right now.",
                    "error"
                );
            }
        }
    );
}


/* ============================================================
   APPLICATION NAVIGATION
============================================================ */

function initializeNavigation() {

    document
        .querySelectorAll(
            "[data-app-nav]"
        )
        .forEach(
            (button) => {

                button.addEventListener(
                    "click",
                    () => {

                        const target =
                            button.dataset
                                .appNav;

                        const routes = {

                            home:
                                "app.html",

                            discover:
                                "discover.html",

                            notifications:
                                "notifications.html",

                            messages:
                                "messages.html",

                            profile:
                                "profile.html",

                            settings:
                                "settings.html",

                            safety:
                                "safety.html"
                        };

                        const route =
                            routes[
                                target
                            ];

                        if (!route) {
                            return;
                        }

                        window.location.href =
                            route;
                    }
                );
            }
        );
}


/* ============================================================
   MODAL HELPERS
============================================================ */

function getOrCreateModal(
    id
) {

    let modal =
        document.getElementById(
            id
        );

    if (modal) {
        return modal;
    }

    modal =
        document.createElement(
            "div"
        );

    modal.id =
        id;

    modal.className =
        "lmf-modal";

    modal.hidden =
        true;

    document.body.appendChild(
        modal
    );

    injectModalStyles();

    return modal;
}


function showModal(
    modal
) {

    if (!modal) {
        return;
    }

    modal.hidden =
        false;

    modal.style.position =
        "fixed";

    modal.style.inset =
        "0";

    modal.style.zIndex =
        "10000";

    modal.style.display =
        "grid";

    modal.style.placeItems =
        "center";

    modal.style.padding =
        "20px";

    document.body.style.overflow =
        "hidden";
}


function closeModal(
    modal
) {

    if (!modal) {
        return;
    }

    modal.hidden =
        true;

    modal.innerHTML =
        "";

    document.body.style.overflow =
        "";
}


function injectModalStyles() {

    if (
        document.getElementById(
            "lmf-runtime-modal-styles"
        )
    ) {
        return;
    }

    const style =
        document.createElement(
            "style"
        );

    style.id =
        "lmf-runtime-modal-styles";

    style.textContent = `

        .lmf-modal {
            font-family:
                Inter,
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
        }

        .lmf-modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.72);
            backdrop-filter: blur(8px);
        }

        .lmf-modal-card {
            position: relative;
            z-index: 2;
            width: min(100%, 520px);
            max-height: calc(100vh - 40px);
            overflow-y: auto;
            padding: 26px;
            border-radius: 24px;
            background: #14121d;
            border: 1px solid rgba(255,255,255,.10);
            color: #f8f7fb;
            box-shadow:
                0 30px 100px rgba(0,0,0,.50);
        }

        .lmf-modal-card h2 {
            margin: 0 0 10px;
            font-size: 24px;
        }

        .lmf-modal-card p {
            color: #aaa6b8;
            line-height: 1.6;
        }

        .lmf-modal-subtitle {
            padding: 12px;
            border-radius: 14px;
            background: rgba(255,255,255,.04);
        }

        .lmf-modal-card textarea,
        .lmf-modal-card select {
            width: 100%;
            margin-top: 12px;
            border: 1px solid rgba(255,255,255,.10);
            border-radius: 14px;
            background: #0d0c14;
            color: #fff;
            outline: none;
            padding: 13px;
        }

        .lmf-modal-card textarea {
            resize: vertical;
            min-height: 120px;
        }

        .lmf-modal-card textarea:focus,
        .lmf-modal-card select:focus {
            border-color: #8b5cf6;
            box-shadow:
                0 0 0 3px rgba(139,92,246,.15);
        }

        .lmf-modal-close {
            position: absolute;
            top: 12px;
            right: 12px;
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 12px;
            background: rgba(255,255,255,.06);
            color: #fff;
            font-size: 24px;
        }

        .lmf-modal-icon {
            font-size: 38px;
            margin-bottom: 10px;
        }

        .lmf-modal-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-top: 12px;
            color: #aaa6b8;
            font-size: 13px;
        }

        .lmf-modal-primary,
        .lmf-danger-button,
        .lmf-secondary-button {
            width: 100%;
            min-height: 46px;
            border: 0;
            border-radius: 14px;
            padding: 12px 16px;
            margin-top: 14px;
            font-weight: 700;
            cursor: pointer;
        }

        .lmf-modal-primary {
            color: #fff;
            background:
                linear-gradient(
                    135deg,
                    #8b5cf6,
                    #ec4899
                );
        }

        .lmf-danger-button {
            color: #fff;
            background: #b91c1c;
        }

        .lmf-secondary-button {
            color: #fff;
            background: rgba(255,255,255,.08);
        }

        .lmf-modal-primary:disabled,
        .lmf-danger-button:disabled,
        .lmf-secondary-button:disabled {
            opacity: .55;
            cursor: not-allowed;
        }

        .lmf-info-box {
            display: grid;
            gap: 6px;
            padding: 15px;
            margin-top: 16px;
            border-radius: 16px;
            background:
                rgba(139,92,246,.10);
            border:
                1px solid rgba(139,92,246,.20);
        }

        .lmf-info-box span {
            color: #aaa6b8;
            line-height: 1.5;
            font-size: 14px;
        }

        .lmf-modal-note {
            font-size: 13px;
        }

        .lmf-safety-actions {
            display: grid;
            gap: 2px;
        }

        @media (max-width: 520px) {

            .lmf-modal-card {
                padding: 20px;
                border-radius: 20px;
            }

            .lmf-modal-footer {
                align-items: stretch;
                flex-direction: column;
            }
        }
    `;

    document.head.appendChild(
        style
    );
}


/* ============================================================
   TEXT HELPERS
============================================================ */

function truncateText(
    value,
    maxLength
) {

    const text =
        normalizeText(
            value
        );

    if (
        text.length <=
        maxLength
    ) {

        return text;
    }

    return (
        text.slice(
            0,
            maxLength - 1
        ) +
        "…"
    );
}


/* ============================================================
   ESCAPE KEY
============================================================ */

function initializeEscapeHandling() {

    document.addEventListener(
        "keydown",
        (event) => {

            if (
                event.key !==
                "Escape"
            ) {
                return;
            }

            document
                .querySelectorAll(
                    ".lmf-modal"
                )
                .forEach(
                    (modal) => {

                        if (!modal.hidden) {

                            closeModal(
                                modal
                            );
                        }
                    }
                );
        }
    );
}


/* ============================================================
   PAGE CLEANUP
============================================================ */

window.addEventListener(
    "beforeunload",
    () => {

        stopFeed();

        document.body.style.overflow =
            "";
    }
);


/* ============================================================
   PUBLIC APPLICATION API
============================================================ */

window.ListenMyFeelingsApp = {

    getCurrentUser() {

        return state.user;
    },

    getFeelings() {

        return [
            ...state.feelings
        ];
    },

    refreshFeed() {

        startFeed();
    },

    saveDraft,

    restoreDraft,

    clearDraft,

    openResponseComposer,

    openSafetyMenu
};


/* ============================================================
   INITIALIZATION
============================================================ */

initializeComposer();

initializeSearch();

initializeFilter();

initializeLogout();

initializeNavigation();

initializeEscapeHandling();

initializeAuthentication();
