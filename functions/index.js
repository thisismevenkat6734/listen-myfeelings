"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  setGlobalOptions
} = require("firebase-functions/v2");

const {
  initializeApp
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue,
  Timestamp
} = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();

setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10
});


/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function requireAuth(request) {

  if (!request.auth) {

    throw new HttpsError(
      "unauthenticated",
      "You must be signed in."
    );
  }

  return request.auth.uid;
}


function cleanString(value, maxLength) {

  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }

  return cleaned;
}


function getConnectionId(userA, userB) {

  return [userA, userB]
    .sort()
    .join("_");
}


function getChatId(userA, userB) {

  return [userA, userB]
    .sort()
    .join("_");
}


async function isBlocked(userA, userB) {

  const firstBlock =
    await db
      .collection("blocks")
      .doc(`${userA}_${userB}`)
      .get();

  if (firstBlock.exists) {
    return true;
  }


  const reverseBlock =
    await db
      .collection("blocks")
      .doc(`${userB}_${userA}`)
      .get();

  return reverseBlock.exists;
}


async function getActiveConnection(
  userA,
  userB
) {

  const connectionId =
    getConnectionId(
      userA,
      userB
    );

  const snapshot =
    await db
      .collection("connections")
      .doc(connectionId)
      .get();


  if (!snapshot.exists) {
    return null;
  }


  const data =
    snapshot.data();


  if (!data.expiresAt) {
    return null;
  }


  const expiresAt =
    data.expiresAt.toMillis();


  if (
    expiresAt <= Date.now()
  ) {
    return null;
  }


  return {
    id: connectionId,
    ...data
  };
}


/*
|--------------------------------------------------------------------------
| Get connection status
|--------------------------------------------------------------------------
*/

exports.getConnectionStatus =
  onCall(
    {
      enforceAppCheck: false
    },
    async (request) => {

      const uid =
        requireAuth(request);

      const targetUserId =
        cleanString(
          request.data?.targetUserId,
          128
        );


      if (!targetUserId) {

        throw new HttpsError(
          "invalid-argument",
          "Target user is required."
        );
      }


      if (
        targetUserId === uid
      ) {

        throw new HttpsError(
          "invalid-argument",
          "You cannot connect with yourself."
        );
      }


      const blocked =
        await isBlocked(
          uid,
          targetUserId
        );


      if (blocked) {

        return {
          connected: false,
          blocked: true,
          expiresAt: null
        };
      }


      const connection =
        await getActiveConnection(
          uid,
          targetUserId
        );


      if (!connection) {

        return {
          connected: false,
          blocked: false,
          expiresAt: null
        };
      }


      return {
        connected: true,
        blocked: false,
        expiresAt:
          connection.expiresAt.toMillis()
      };
    }
  );


/*
|--------------------------------------------------------------------------
| Create connection after trusted ad verification
|--------------------------------------------------------------------------
|
| IMPORTANT:
| This function does NOT trust a browser-provided
| "watchedAd = true" flag.
|
| The rewarded-ad provider verification must happen
| server-side before this function is allowed to
| create the unlock.
|
| For now this function requires a server-created
| adUnlock document with:
|
| verified: true
| used: false
| userId: current user
|
|--------------------------------------------------------------------------
*/

exports.createConnection =
  onCall(
    {
      enforceAppCheck: false
    },
    async (request) => {

      const uid =
        requireAuth(request);


      const targetUserId =
        cleanString(
          request.data?.targetUserId,
          128
        );


      const unlockId =
        cleanString(
          request.data?.unlockId,
          128
        );


      if (!targetUserId) {

        throw new HttpsError(
          "invalid-argument",
          "Target user is required."
        );
      }


      if (
        targetUserId === uid
      ) {

        throw new HttpsError(
          "invalid-argument",
          "You cannot connect with yourself."
        );
      }


      if (!unlockId) {

        throw new HttpsError(
          "failed-precondition",
          "A verified rewarded-ad unlock is required."
        );
      }


      const blocked =
        await isBlocked(
          uid,
          targetUserId
        );


      if (blocked) {

        throw new HttpsError(
          "permission-denied",
          "Connection is not available."
        );
      }


      const unlockRef =
        db
          .collection("adUnlocks")
          .doc(unlockId);


      const connectionRef =
        db
          .collection("connections")
          .doc(
            getConnectionId(
              uid,
              targetUserId
            )
          );


      const chatRef =
        db
          .collection("chats")
          .doc(
            getChatId(
              uid,
              targetUserId
            )
          );


      const result =
        await db.runTransaction(
          async (transaction) => {

            const unlockSnapshot =
              await transaction.get(
                unlockRef
              );


            if (
              !unlockSnapshot.exists
            ) {

              throw new HttpsError(
                "permission-denied",
                "Invalid ad unlock."
              );
            }


            const unlock =
              unlockSnapshot.data();


            if (
              unlock.userId !== uid
            ) {

              throw new HttpsError(
                "permission-denied",
                "Invalid ad unlock owner."
              );
            }


            if (
              unlock.verified !== true
            ) {

              throw new HttpsError(
                "failed-precondition",
                "The rewarded ad has not been verified."
              );
            }


            if (
              unlock.used === true
            ) {

              throw new HttpsError(
                "failed-precondition",
                "This ad unlock has already been used."
              );
            }


            const now =
              Date.now();


            if (
              unlock.expiresAt &&
              unlock.expiresAt.toMillis() <= now
            ) {

              throw new HttpsError(
                "deadline-exceeded",
                "This ad unlock has expired."
              );
            }


            const existingConnection =
              await transaction.get(
                connectionRef
              );


            if (
              existingConnection.exists
            ) {

              const existing =
                existingConnection.data();


              if (
                existing.expiresAt &&
                existing.expiresAt.toMillis() >
                  now
              ) {

                return {
                  connectionId:
                    connectionRef.id,

                  chatId:
                    chatRef.id,

                  expiresAt:
                    existing.expiresAt.toMillis()
                };
              }
            }


            const expiresAt =
              Timestamp.fromMillis(
                now +
                12 * 60 * 60 * 1000
              );


            transaction.set(
              connectionRef,
              {
                userA: uid < targetUserId
                  ? uid
                  : targetUserId,

                userB: uid < targetUserId
                  ? targetUserId
                  : uid,

                status: "active",

                source: "rewarded_ad",

                unlockId,

                createdAt:
                  FieldValue.serverTimestamp(),

                expiresAt
              },
              {
                merge: true
              }
            );


            transaction.set(
              chatRef,
              {
                userA: uid < targetUserId
                  ? uid
                  : targetUserId,

                userB: uid < targetUserId
                  ? targetUserId
                  : uid,

                status: "active",

                connectionId:
                  connectionRef.id,

                createdAt:
                  FieldValue.serverTimestamp(),

                updatedAt:
                  FieldValue.serverTimestamp()
              },
              {
                merge: true
              }
            );


            transaction.update(
              unlockRef,
              {
                used: true,

                usedAt:
                  FieldValue.serverTimestamp(),

                connectionId:
                  connectionRef.id
              }
            );


            return {
              connectionId:
                connectionRef.id,

              chatId:
                chatRef.id,

              expiresAt:
                expiresAt.toMillis()
            };
          }
        );


      return {
        success: true,
        ...result
      };
    }
  );


/*
|--------------------------------------------------------------------------
| Send secure chat message
|--------------------------------------------------------------------------
*/

exports.sendMessage =
  onCall(
    {
      enforceAppCheck: false
    },
    async (request) => {

      const uid =
        requireAuth(request);


      const targetUserId =
        cleanString(
          request.data?.targetUserId,
          128
        );


      const text =
        cleanString(
          request.data?.text,
          5000
        );


      if (!targetUserId) {

        throw new HttpsError(
          "invalid-argument",
          "Recipient is required."
        );
      }


      if (!text) {

        throw new HttpsError(
          "invalid-argument",
          "Message cannot be empty."
        );
      }


      if (
        targetUserId === uid
      ) {

        throw new HttpsError(
          "invalid-argument",
          "You cannot message yourself."
        );
      }


      const blocked =
        await isBlocked(
          uid,
          targetUserId
        );


      if (blocked) {

        throw new HttpsError(
          "permission-denied",
          "Messaging is unavailable."
        );
      }


      const connection =
        await getActiveConnection(
          uid,
          targetUserId
        );


      if (!connection) {

        throw new HttpsError(
          "failed-precondition",
          "Your 12-hour connection has expired or does not exist."
        );
      }


      const chatId =
        getChatId(
          uid,
          targetUserId
        );


      const chatRef =
        db
          .collection("chats")
          .doc(chatId);


      const messageRef =
        chatRef
          .collection("messages")
          .doc();


      const batch =
        db.batch();


      batch.set(
        messageRef,
        {
          senderId: uid,
          receiverId: targetUserId,
          text,
          status: "active",
          createdAt:
            FieldValue.serverTimestamp()
        }
      );


      batch.update(
        chatRef,
        {
          updatedAt:
            FieldValue.serverTimestamp(),

          lastMessage:
            text.slice(0, 200),

          lastMessageSenderId:
            uid
        }
      );


      await batch.commit();


      return {
        success: true,
        chatId,
        messageId: messageRef.id
      };
    }
  );


/*
|--------------------------------------------------------------------------
| Check chat access
|--------------------------------------------------------------------------
*/

exports.getChatStatus =
  onCall(
    {
      enforceAppCheck: false
    },
    async (request) => {

      const uid =
        requireAuth(request);


      const targetUserId =
        cleanString(
          request.data?.targetUserId,
          128
        );


      if (!targetUserId) {

        throw new HttpsError(
          "invalid-argument",
          "Recipient is required."
        );
      }


      if (
        targetUserId === uid
      ) {

        throw new HttpsError(
          "invalid-argument",
          "Invalid recipient."
        );
      }


      const connection =
        await getActiveConnection(
          uid,
          targetUserId
        );


      if (!connection) {

        return {
          connected: false,
          expiresAt: null
        };
      }


      return {
        connected: true,
        expiresAt:
          connection.expiresAt.toMillis(),

        chatId:
          getChatId(
            uid,
            targetUserId
          )
      };
    }
  );
