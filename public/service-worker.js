
// Service Worker for background notifications
const CACHE_NAME = 'modernchat-v1';

self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(self.clients.claim());
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', event);
    event.notification.close();

    const data = event.notification.data;
    let url = '/dashboard';

    if (data) {
        switch (data.type) {
            case 'message':
                url = `/chat/${data.userId}`;
                break;
            case 'group-message':
                url = `/groups/${data.groupId}`;
                break;
            case 'call':
            case 'group-call':
                url = data.groupId ? `/groups/${data.groupId}` : `/chat/${data.caller?.id}`;
                break;
        }
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                // Check if there's already a window/tab open with the target URL
                for (const client of clients) {
                    if (client.url.includes(url) && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If not, open a new window/tab
                if (self.clients.openWindow) {
                    return self.clients.openWindow(url);
                }
            })
    );
});

// Handle push messages (for future implementation)
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body,
        icon: data.icon || '/favicon.ico',
        badge: '/favicon.ico',
        data: data.data,
        requireInteraction: data.requireInteraction || false
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});
