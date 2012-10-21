mlpg-newthreadlocator
=====================

ABOUT THIS SCRIPT

The script tries to locate a new MLPG thread by monitoring the current thread for cross-thread links
after the image limit (see Config) has been reached. The script will only run in threads that have
the proper keywords (see Config) in either subject or comment field of the OP, or that have the
MLPG marker posted. Linked threads will be monitored only if the current thread has the marker. If
the marker is not present, cross-thread links will be cached and if/when the marker gets posted, the
cached links will be checked. All linked threads will be monitored until the marker is posted in one
of them. When a marked thread is found, the thread is either opened automatically or a notification
is shown (see Config).

CONFIG

All changes to the configuration must be done manually to the object literal called 'Config'.

Configurable values:

* threadKeywords
- List of keywords (case-insensitive) the script will search from thread's subject and first post.

* markerMD5
- Marker's hash (in img element's data-md5 attribute).

* imageLimit
- Thread image limit at which the script should start looking for cross-thread links.

* APIRequestInterval
- Delay (in seconds) between each request to the 4chan API.

* threadUpdateInterval
- Delay (in seconds) between thread updates.

* threadUpdateTTL
- Time (in seconds) after which a request to the 4chan API times out.

* threadUpdateRetryLimit
- Amount of times the script will try to search each thread for marker (set 0 for infinite).

* newThreadAutoOpen
- True: opens new thread automatically, false: shows a notification when new thread is found.

* newThreadOpenInNewTab
- True: opens new thread in a new tab (enable popups for this!), false: opens new thread in current tab.