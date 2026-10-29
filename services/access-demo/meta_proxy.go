package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Runtime proxy to the installed DAT mock server. No SDK renderer is copied or reimplemented.
func metaProxy() http.Handler {
	target, _ := url.Parse("http://127.0.0.1:9000")
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Host = target.Host
		r.Header.Set("Accept-Encoding", "identity")
		if r.Header.Get("Origin") != "" {
			r.Header.Set("Origin", target.String())
		}
		if r.URL.Path == "/glasses" {
			r.URL.Path = "/"
		}
	}
	proxy.Transport = &http.Transport{ResponseHeaderTimeout: 8 * time.Second}
	proxy.ModifyResponse = func(r *http.Response) error {
		if r.Request.URL.Path != "/" || r.StatusCode != 200 {
			return nil
		}
		data, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		r.Body.Close()
		if err != nil {
			return err
		}
		const adapter = `<link rel="stylesheet" href="/meta-scene.css"><script type="module" src="/src/meta-scene.js"></script>`
		data = bytes.Replace(data, []byte("</head>"), []byte(adapter+"</head>"), 1)
		r.Body = io.NopCloser(bytes.NewReader(data))
		r.ContentLength = int64(len(data))
		r.Header.Set("Content-Length", strconv.Itoa(len(data)))
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if r.URL.Path == "/glasses" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(503)
			io.WriteString(w, `<!doctype html><title>GateLens — Start Meta preview</title><h1>Meta preview is offline</h1><p>Run scripts/start-meta-walkthrough.ps1, or start the linked Flutter preview and forward adb port 9000. Then refresh this page.</p><p><a href="/">Return to the standalone scene</a></p>`)
		} else {
			problem(w, 503, "Meta SDK preview is offline")
		}
	}
	return proxy
}

func isMetaPath(path string) bool {
	return path == "/glasses" || path == "/preview.js" || path == "/preview.css" || path == "/host.js" || strings.HasPrefix(path, "/display/")
}
