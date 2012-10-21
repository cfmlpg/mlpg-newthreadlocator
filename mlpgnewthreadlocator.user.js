// ==UserScript==
// @name           MLPG New Thread Locator
// @version        1.0.1
// @namespace      cfmlpg
// @description    Tries to find a new MLPG from cross-thread links.
// @author         cfmlpg
// @include        http*://boards.4chan.org/mlp/res/*
// @updateURL      https://raw.github.com/cfmlpg/mlpg-newthreadlocator/master/mlpgnewthreadlocator.user.js
// @downloadURL    https://raw.github.com/cfmlpg/mlpg-newthreadlocator/master/mlpgnewthreadlocator.user.js
// @run-at         document-start
// ==/UserScript==

/*
*	ABOUT THIS SCRIPT
*
*	The script tries to locate a new MLPG thread by monitoring the current thread for cross-thread links
*	after the image limit (see Config) has been reached. The script will only run in threads that have
*	the proper keywords (see Config) in either subject or comment field of the OP, or that have the
*	MLPG marker posted. Linked threads will be monitored only if the current thread has the marker. If
*	the marker is not present, cross-thread links will be cached and if/when the marker gets posted, the
*	cached links will be checked. All linked threads will be monitored until the marker is posted in one
*	of them. When a marked thread is found, the thread is either opened automatically or a notification
*	is shown (see Config).
*
*	CONFIG
*
*	All changes to the configuration must be done manually to the object literal called 'Config'.
*
*	Configurable values:
*
*	* threadKeywords *
*	- List of keywords (case-insensitive) the script will search from thread's subject and first post.
*
*	* markerMD5 *
*	- Marker's hash (in img element's data-md5 attribute).
*
*	* imageLimit *
*	- Thread image limit at which the script should start looking for cross-thread links.
*
*	* APIRequestInterval *
*	- Delay (in seconds) between each request to the 4chan API.
*
*	* threadUpdateInterval *
*	- Delay (in seconds) between thread updates.
*
*	* threadUpdateTTL *
*	- Time (in seconds) after which a request to the 4chan API times out.
*
*	* threadUpdateRetryLimit *
*	- Amount of times the script will try to search each thread for marker (set 0 for infinite).
*
*	* newThreadAutoOpen *
*	- True: opens new thread automatically, false: shows a notification when new thread is found.
*
*	* newThreadOpenInNewTab *
*	- True: opens new thread in a new tab (enable popups for this!), false: opens new thread in current tab.
*	
*/

(function()
{
	'use strict';
	
	var Config, d, $, $$, APIRequest, NewThreadMonitor, Thread, ThreadObserver;
	var ThreadProcessor, PostProcessor, CrossThreadIdCache, UI, Main;
	
	/*********************************************************************
	*	Config
	*********************************************************************/
	
	Config = 
	{
		/* List of keywords (case-insensitive) the script will search from thread's subject and first post	*/
		threadKeywords:
		[ 
			'MLP General', 'MLPG', 'My Little Pony General',
			'Hub', 'MLP', 'Pony', 'Ponies'
		],

		/* Marker's hash (in img element's data-md5 attribute) */
		markerMD5: 'YgIC5DRjGYcY2F4I+vJkOw==',
		
		/* Thread image limit at which the script should start looking for cross-thread links */
		imageLimit: 230,
		
		/* Delay (in seconds) between each request to the 4chan API */
		APIRequestInterval: 1,
		
		/* Delay (in seconds) between thread updates */
		threadUpdateInterval: 10,
		
		/* Time (in seconds) after which a request to the 4chan API times out */
		threadUpdateTTL: 10,
		
		/* Amount of times the script will try to search each thread for marker (set 0 for infinite) */
		threadUpdateRetryLimit: 0,
		
		/* True: opens new thread automatically, false: shows a notification when new thread is found */
		newThreadAutoOpen: false,
		
		/* True: opens new thread in a new tab (enable popups for this!), false: opens new thread in current tab */
		newThreadOpenInNewTab: true
	};
	
	/*********************************************************************
	*	Document shorthand
	*********************************************************************/
	
	d = document;
	
	/*********************************************************************
	*	"jQuery"
	*********************************************************************/
	
	$ = function(selector, element)
	{
		return (element || d).querySelector(selector);
	};
	
	$$ = function(selector, element)
	{
		return [].slice.call((element || d).querySelectorAll(selector));
	};
	
	$.ready = function(func)
	{
		if ((d.readyState === 'complete') || (d.readyState === 'interactive'))
			return setTimeout(func);
		$.one('DOMContentLoaded', func);
	};
	
	$.on = function(eventType, eventListener, element)
	{
		(element || d).addEventListener(eventType, eventListener, false);
	};

	$.off = function(eventType, eventListener, element)
	{
		(element || d).removeEventListener(eventType, eventListener, false);
	};
	
	$.one = function(eventType, eventListener, element)
	{
		var callback;
		if (!element)
			element = d;
		callback = function(event)
		{
			$.off(eventType, callback, element);
			eventListener(event);
		};
		$.on(eventType, callback, element);
	};
	
	$.el = function(tag, attributes)
	{
		var el = d.createElement(tag);
		if (attributes)
			for (var key in attributes)
				el[key] = attributes[key];
		return el;
	};
	
	$.tn = function(text)
	{
		return d.createTextNode(text);
	};
	
	$.add = function(parent, child)
	{
		return parent.appendChild(child);
	};
	
	$.rm = function(element)
	{
		return element.parentNode.removeChild(element);
	};
	
	$.open = function(url, name)
	{
		return window.open(location.protocol + '//' + url, (name) ? name : '_blank');
	};
	
	$.id = function(id)
	{
		return d.getElementById(id);
	};
	
	/*********************************************************************
	*	APIRequest
	*********************************************************************/
	
	APIRequest = function(threadId, properties, headers)
	{
		var request = null;
		var aborted = false;
		
		this.send = function()
		{
			if (!aborted)
			{
				request = new XMLHttpRequest();
				request.open('GET', location.protocol + '//api.4chan.org/mlp/res/' + threadId + '.json?' + Date.now(), true);
				for (var key in headers)
					request.setRequestHeader(key, headers[key]);
				for (var key in properties)
					request[key] = properties[key];
				request.send();
			}
		};
		
		this.abort = function()
		{
			if (request && request.readyState !== 4)
				request.abort();
			aborted = true;
		};
		
		APIRequest.Queue.add(this);
	};
	
	APIRequest.Queue = new (function()
	{
		var queue = [];
		var intervalVar = null;
		var running = false;
		
		var start = function()
		{
			if (!intervalVar)
			{
				intervalVar = setInterval(poll, (Config.APIRequestInterval * 1000));
				running = true;
			}
		};
		
		var poll = function()
		{
			if (queue.length)
				queue.shift().send();
		};
		
		this.add = function(request)
		{
			if (!running)
				start();
			queue.push(request);
		};
		
		this.stop = function()
		{
			running = false;
			if (intervalVar)
				clearInterval(intervalVar);
			queue = [];
		};
		
	})();
	
	/*********************************************************************
	*	NewThreadMonitor
	*********************************************************************/
	
	NewThreadMonitor = function(threadId)
	{
		var callbacks = [];
		var isGeneral = false;
		var request = null;
		var requestTimeout = null;
		var tryCount = 0;
		var running = true;
		
		var processResponse = function(req)
		{
			var data;
			if ((data = JSON.parse(req.response)))
			{
				if (!isGeneral)
				{
					if (validateThread(data.posts[0]))
						isGeneral = true;
					else
						return;
				}
				for (var i = 0; i < data.posts.length; ++i)
				{
					if ((data.posts[i].md5) && (data.posts[i].md5 === Config.markerMD5))
					{
						callbacks.forEach(function(cb) { cb(threadId); });
						return;
					}
				}
			}
			createRequest(req, Config.threadUpdateInterval);
		};
		
		var validateThread = function(post)
		{
			var r;
			r = new RegExp(Config.threadKeywords.join('|'), 'i');
			return ((post.sub && r.test(post.sub)) || (post.com && r.test(post.com)));
		};
		
		var createRequest = function(oldReq, delay)
		{
			var properties, headers, lastMod;
			if ((running) && ((Config.threadUpdateRetryLimit === 0) || (tryCount < Config.threadUpdateRetryLimit)))
			{
				properties =
				{
					onloadend: function()
					{
						if (this.status === 200)
							processResponse(this);
						else if ((this.status === 304) || (this.status === 0))
							createRequest(this, Config.threadUpdateInterval);
					},
					timeout: (Config.threadUpdateTTL * 1000)
				};
				headers = {};
				if ((oldReq) && (lastMod = oldReq.getResponseHeader('Last-Modified')))
				{
					headers['If-Modified-Since'] = lastMod;
				}
				if (delay)
				{
					requestTimeout = setTimeout
					(
						function()
						{
							request = new APIRequest(threadId, properties, headers);
						},
						(delay * 1000)
					);
				}
				else
				{
					request = new APIRequest(threadId, properties, headers);
				}
				++tryCount;
			}
		};
		
		var abortRequest = function()
		{
			if (requestTimeout)
				clearTimeout(requestTimeout);
			if (request)
				request.abort();
		};
		
		this.stop = function()
		{
			if (running)
				running = false;
			abortRequest();
		};
		
		this.addCallback = function(cb)
		{
			callbacks.push(cb);
		}
		
		createRequest();
	};
	
	/*********************************************************************
	*	Thread
	*********************************************************************/
	
	Thread = function(postProcessor)
	{
		this.id = '';
		this.images = 0;
		this.posts = 0;
		this.hasKeywords = false;
		this.hasMarker = false;
		this.imageLimitReached = false;
		
		var self = this;
		
		var __construct = function()
		{
			var m, subj, posts, images;
			if ((m = document.URL.match(/^https?\:\/\/boards\.4chan\.org\/mlp\/res\/(\d+)/)))
			{
				self.id = m[1];
				self.hasKeywords = hasKeywords();
				self.hasMarker = hasMarker();
				if (self.hasKeywords || self.hasMarker)
				{
					self.posts = getPostCount();
					self.images = getImageCount();
					if (imageLimitReached())
						self.imageLimitReached = true;
				}
			}
		};
		
		var hasKeywords = function()
		{
			var subjEl, commEl, r;
			r = new RegExp(Config.threadKeywords.join('|'), 'i');
			if
			(
				((subjEl = $('span.subject')) && (r.test(subjEl.innerHTML))) ||
				((commEl = $('div.postMessage')) && (r.test(commEl.innerHTML)))
			)
				return true;
			return false;
		};
		
		var hasMarker = function()
		{
			return $$('img[data-md5]').some
			(
				function(node) { return (node.getAttribute('data-md5') === Config.markerMD5); }
			);
		};
		
		var getPostCount = function()
		{
			return ($$('.postContainer').length);
		};
		
		var getImageCount = function()
		{
			return ($$('img[data-md5]').length);
		};
		
		var imageLimitReached = function()
		{
			return (self.images >= Config.imageLimit);
		};
		
		this.update = function(post)
		{
			if (postProcessor.isPost(post))
			{
				++this.posts;
				if (postProcessor.hasImage(post))
				{
					++this.images;
					if ((!this.hasMarker) && (postProcessor.hasMarker(post)))
						this.hasMarker = true;
					if ((!this.imageLimitReached) && (imageLimitReached()))
						this.imageLimitReached = true;
				}
			}
		};
		
		__construct();
	};
	
	/*********************************************************************
	*	ThreadObserver
	*********************************************************************/
	
	ThreadObserver = function()
	{
		var observer;
		var callbacks = [];
		
		this.addCallback = function(cb)
		{
			callbacks.push(cb);
		};
		
		this.observe = function()
		{
			var MutationObserver, element, callback;
			if (!observer)
			{
				MutationObserver = window.MutationObserver || window.WebKitMutationObserver || window.MozMutationObserver;
				if ((MutationObserver) && (element = $('.thread')))
				{
					callback = function(mutations)
					{
						mutations.forEach(function(mutation)
						{
							callbacks.forEach(function(cb) { cb(mutation.addedNodes); });
						});
					};
					observer = new MutationObserver(callback);
					observer.observe(element, { childList: true });
				}
			}
		};
		
		this.disconnect = function()
		{
			if (observer)
				observer.disconnect();
		};
	};
	
	/*********************************************************************
	*	ThreadProcessor
	*********************************************************************/
	
	ThreadProcessor =
	{
		process: function(postProcessor, imageCount, threadId, callback)
		{
			var ids, postIds, posts, i;
			ids = [];
			posts = $$('.postContainer');
			i = (posts.length - 1);
			while (imageCount >= Config.imageLimit)
			{
				postIds = postProcessor.getCrossThreadIds(posts[i], threadId);
				for (var j = 0; j < postIds.length; ++j)
				{
					ids.push(postIds[j]);
				}
				if (postProcessor.hasImage(posts[i]))
				{
					--imageCount;
				}
				--i;
			}
			if (ids.length)
				callback(ids);
		}
	};
	
	/*********************************************************************
	*	PostProcessor
	*********************************************************************/
	
	PostProcessor = 
	{
		isPost: function(node)
		{
			return (/postContainer/.test(node.className));
		},
		
		hasImage: function(node)
		{
			return ($('img[data-md5]', node) != null);
		},
		
		hasMarker: function(node)
		{
			var el = $('img[data-md5]', node);
			if (el.getAttribute('data-md5') === Config.markerMD5)
				return true;
			return false;
		},
		
		getCrossThreadIds: function(node, currentId)
		{
			var m, id, parsedIds, links;
			parsedIds = [];
			if ((links = $$('span.quote>a', node)).length)
			{
				for (var i = 0; i < links.length; ++i)
				{
					if ((m = links[i].getAttribute('href').match(/^(\/mlp\/res\/)?(\d+)/)))
					{
						id = m[2];
						if ((id !== currentId) && (parsedIds.indexOf(id) === -1))
						{
							parsedIds.push(id);
						}
					}
				}
			}
			return parsedIds;
		}
	};
	
	/*********************************************************************
	*	CrossThreadIdCache
	*********************************************************************/
	
	CrossThreadIdCache = function()
	{
		var cache = [];
		
		var contains = function(item)
		{
			return (cache.indexOf(item) !== -1);
		};
		
		this.push = function(items)
		{
			var arr = [].concat(items);
			for (var i = 0; i < arr.length; ++i)
				if (!contains(arr[i]))
					cache.push(arr[i]);
		};
		
		this.shiftAll = function()
		{
			var items = [];
			while (cache.length)
				items.push(cache.shift());
			return items;
		};
	};
	
	/*********************************************************************
	*	UI
	*********************************************************************/
	
	var UI =
	{
		notification:
		{
			element: null,
			
			show: function(message, onOKClicked)
			{
				var fragment, overlay, box, header, closeImg, text, okButton;
				if (UI.notification.element == null)
				{
					fragment = d.createDocumentFragment();
					overlay = $.el('div', { id: 'settingsMenu', className: 'UIPanel'});
					$.one('click', UI.notification.hide, overlay); 
					box = $.el('div', { className: 'extPanel reply' });
					box.style.textAlign = 'center';
					header = $.el('div', { className: 'panelHeader' });
					$.add(header, $.tn('Notification'));
					$.add(header, $.el('span'));
					closeImg = $.el('img', { className: 'pointer', alt: 'Close', title: 'Close', src: '//static.4chan.org/image/buttons/burichan/cross.png' });
					$.one('click', UI.notification.hide, closeImg); 
					$.add(header.childNodes[1], closeImg);
					text = $.el('p');
					$.add(text, $.tn(message));
					okButton = $.el('input', { type: 'button', value: 'Go!' });
					$.one('click', function() { onOKClicked(); UI.notification.hide(); }, okButton);
					$.add(box, header);
					$.add(box, text);
					$.add(box, okButton);
					$.add(overlay, box);
					$.add(fragment, overlay);
					$.add(d.body, fragment);
					UI.notification.element = overlay;
				}
			},
			
			hide: function()
			{
				if (UI.notification.element != null)
				{
					$.rm(UI.notification.element);
					UI.notification.element = null;
				}
			}
		}
	};
	
	/*********************************************************************
	*	Main
	*********************************************************************/
	
	Main =
	{
		thread: null,
		threadObserver: null,
		crossThreadIdCache: null,
		newThreadMonitors: {},
	
		onReady: function()
		{
			var cb;
			Main.thread = new Thread(PostProcessor);
			if (Main.thread.hasKeywords || Main.thread.hasMarker)
			{
				Main.threadObserver = new ThreadObserver();
				Main.threadObserver.addCallback(Main.onNewPosts);
				Main.threadObserver.observe();
				Main.crossThreadIdCache = new CrossThreadIdCache();
				if (Main.thread.imageLimitReached)
				{
					cb = function(ids)
					{
						Main.crossThreadIdCache.push(ids);
						if (Main.thread.hasMarker)
							Main.processCache();
					};
					ThreadProcessor.process(PostProcessor, Main.thread.images, Main.thread.id, cb);
				}
			}
		},
		
		onNewPosts: function(nodes)
		{
			for (var i = 0; i < nodes.length; ++i)
			{
				Main.thread.update(nodes[i]);
				if (Main.thread.imageLimitReached)
					Main.crossThreadIdCache.push(PostProcessor.getCrossThreadIds(nodes[i], Main.thread.id));
			}
			if (Main.thread.hasMarker)
				Main.processCache();
		},
		
		processCache: function()
		{
			var ids;
			ids = Main.crossThreadIdCache.shiftAll();
			if (ids.length)
				setTimeout(function() { Main.onCrossThreadLinksFound(ids); });
		},
		
		onCrossThreadLinksFound: function(ids)
		{
			var monitor;
			for (var i = 0; i < ids.length; ++i)
			{
				if (!(ids[i] in Main.newThreadMonitors))
				{
					monitor = new NewThreadMonitor(ids[i]);
					monitor.addCallback(Main.onNewThreadFound);
					Main.newThreadMonitors[ids[i]] = monitor;
				}
			}
		},
		
		onNewThreadFound: function(threadId)
		{
			var cb;
			Main.onExit();
			cb = function()
			{
				$.open
				(
					'boards.4chan.org/mlp/res/' + threadId + '#p' + threadId,
					(Config.newThreadOpenInNewTab) ? '_blank' : '_self'
				);
			};
			if (Config.newThreadAutoOpen)
				cb();
			else
				UI.notification.show('New thread (id: ' + threadId + ') found!', cb);
		},
		
		onExit: function()
		{
			Main.threadObserver.disconnect();
			for (var key in Main.newThreadMonitors)
				Main.newThreadMonitors[key].stop();
			APIRequest.Queue.stop();
		}
	};
	
	// Wait for document to finish loading
	$.ready(Main.onReady);

})();