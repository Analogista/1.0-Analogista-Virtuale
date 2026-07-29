import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

describe('Firestore Security Rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'gen-lang-client-0002179242',
      firestore: {
        rules: `
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              match /{document=**} { allow read, write: if false; }
              function isSignedIn() { return request.auth != null; }
              function isEmailVerified() { return isSignedIn() && request.auth.token.email_verified == true; }
              function isAdmin() { return isSignedIn() && request.auth.token.email == 'analogistabrindisi@gmail.com' && isEmailVerified(); }
              function isValidSession(data) {
                return data.keys().hasAll(['userId', 'createdAt', 'status']) &&
                       data.userId is string &&
                       data.createdAt == request.time &&
                       data.status in ['in_progress', 'completed'];
              }
              match /sessions/{sessionId} {
                allow get, list: if isSignedIn() && (resource.data.userId == request.auth.uid || isAdmin());
                allow create: if isSignedIn() && isValidSession(request.resource.data) && request.resource.data.userId == request.auth.uid;
              }
            }
          }
        `,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('should deny unauthorized access', async () => {
    const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthenticatedDb, 'sessions/test')));
  });

  it('should allow owner to create session', async () => {
    const aliceDb = testEnv.authenticatedContext('alice', { email_verified: true }).firestore();
    await assertSucceeds(setDoc(doc(aliceDb, 'sessions/1'), {
      userId: 'alice',
      createdAt: new Date(), // This depends on implementation details of rules-unit-testing mock time
      status: 'in_progress'
    }));
  });

  it('should deny spoofing ownerId', async () => {
    const aliceDb = testEnv.authenticatedContext('alice', { email_verified: true }).firestore();
    await assertFails(setDoc(doc(aliceDb, 'sessions/2'), {
      userId: 'bob',
      createdAt: new Date(),
      status: 'in_progress'
    }));
  });
});
