package com.shatteredcrown.rpg;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Build;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Embedded pure-Java HTTP + RFC 6455 WebSocket PvP Server for Android APK Phone-to-Phone LAN play.
 * Mirrors server.js lobby/match protocol on TCP 8080 + UDP 8081 Wi-Fi discovery.
 */
public final class LocalPvpServer {
    public static final int DEFAULT_PORT = 8080;
    public static final int DISCOVERY_PORT = 8081;
    private static final String DISCOVER_QUERY = "DISCOVER_SHATTERED_CROWN";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private static final class Client {
        final String id;
        final String ip;
        final Socket socket;
        final OutputStream out;
        volatile String roomId;

        Client(String id, String ip, Socket socket, OutputStream out) {
            this.id = id;
            this.ip = ip;
            this.socket = socket;
            this.out = out;
        }
    }

    private static final class PlayerSlot {
        final String id;
        final Client client;
        String heroName;
        String heroClass;
        String appVersion;
        JSONArray loadout;
        boolean ready;
        int lastHp = 5000;

        PlayerSlot(String id, Client client, String heroName, String heroClass, String appVersion, JSONArray loadout) {
            this.id = id;
            this.client = client;
            this.heroName = heroName;
            this.heroClass = heroClass;
            this.appVersion = appVersion != null ? appVersion : "unknown";
            this.loadout = loadout;
            this.ready = false;
        }
    }

    private static final class Room {
        final String id;
        final String name;
        int mapId;
        final String passwordHash;
        String hostIp;
        String status = "lobby";
        int round = 1;
        boolean roundEnded = false;
        ScheduledFuture<?> roundTimer;
        ScheduledFuture<?> autoStartTimer;
        long autoStartAt = 0L;
        final int[] scores = new int[]{0, 0};
        final List<PlayerSlot> players = new ArrayList<>();

        Room(String id, String name, int mapId, String passwordHash, String hostIp) {
            this.id = id;
            this.name = name;
            this.mapId = mapId;
            this.passwordHash = passwordHash;
            this.hostIp = hostIp;
        }
    }

    private final Context appContext;
    private volatile boolean running = false;
    private ServerSocket serverSocket;
    private DatagramSocket discoverySocket;
    private Thread acceptThread;
    private Thread discoveryThread;
    private ScheduledExecutorService scheduler;

    private final Map<String, Client> clients = new ConcurrentHashMap<>();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private int nextClientId = 1;
    private int nextRoomNum = 1;
    private int boundPort = DEFAULT_PORT;

    public LocalPvpServer(Context context) {
        this.appContext = context.getApplicationContext();
    }

    public synchronized boolean start(int port) throws IOException {
        if (running) return true;
        boundPort = port > 0 ? port : DEFAULT_PORT;
        serverSocket = new ServerSocket();
        serverSocket.setReuseAddress(true);
        serverSocket.bind(new InetSocketAddress("0.0.0.0", boundPort));
        running = true;
        scheduler = Executors.newSingleThreadScheduledExecutor();

        acceptThread = new Thread(this::acceptLoop, "ShatteredCrown-LAN-Accept");
        acceptThread.setDaemon(true);
        acceptThread.start();

        discoveryThread = new Thread(this::discoveryLoop, "ShatteredCrown-LAN-Discovery");
        discoveryThread.setDaemon(true);
        discoveryThread.start();
        return true;
    }

    public synchronized void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        serverSocket = null;
        try {
            if (discoverySocket != null) discoverySocket.close();
        } catch (Exception ignored) {}
        discoverySocket = null;

        for (Client c : clients.values()) {
            try {
                c.socket.close();
            } catch (IOException ignored) {}
        }
        clients.clear();
        for (Room r : rooms.values()) {
            if (r.roundTimer != null) r.roundTimer.cancel(false);
        }
        rooms.clear();
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }

    public boolean isRunning() {
        return running && serverSocket != null && !serverSocket.isClosed();
    }

    public int getPort() {
        return boundPort;
    }

    public static String getLocalLanIp() {
        String bestFallback = null;
        try {
            Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
            while (ifaces != null && ifaces.hasMoreElements()) {
                NetworkInterface nif = ifaces.nextElement();
                if (!nif.isUp() || nif.isLoopback() || nif.isVirtual()) continue;
                String ifName = nif.getName().toLowerCase(Locale.ROOT);
                boolean preferred = ifName.contains("wlan") || ifName.contains("ap") || ifName.contains("swlan") || ifName.contains("eth");
                Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (!(addr instanceof Inet4Address) || addr.isLoopbackAddress()) continue;
                    String host = addr.getHostAddress();
                    if (host == null) continue;
                    if (host.startsWith("192.168.") || host.startsWith("10.") || host.matches("^172\\.(1[6-9]|2\\d|3[0-1])\\..*")) {
                        if (preferred) return host;
                        if (bestFallback == null) bestFallback = host;
                    }
                }
            }
        } catch (Exception ignored) {}
        return bestFallback != null ? bestFallback : "127.0.0.1";
    }

    public static JSONArray discoverLanHosts(int timeoutMs) {
        Map<String, JSONObject> found = new LinkedHashMap<>();
        try (DatagramSocket ds = new DatagramSocket()) {
            ds.setBroadcast(true);
            ds.setSoTimeout(Math.max(250, timeoutMs));
            byte[] queryBytes = DISCOVER_QUERY.getBytes(StandardCharsets.UTF_8);

            List<InetAddress> targets = new ArrayList<>();
            try {
                targets.add(InetAddress.getByName("255.255.255.255"));
            } catch (Exception ignored) {}

            try {
                Enumeration<NetworkInterface> ifaces = NetworkInterface.getNetworkInterfaces();
                while (ifaces != null && ifaces.hasMoreElements()) {
                    NetworkInterface nif = ifaces.nextElement();
                    if (!nif.isUp() || nif.isLoopback()) continue;
                    for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                        InetAddress bcast = ia.getBroadcast();
                        if (bcast != null) targets.add(bcast);
                    }
                }
            } catch (Exception ignored) {}

            for (InetAddress target : targets) {
                try {
                    ds.send(new DatagramPacket(queryBytes, queryBytes.length, target, DISCOVERY_PORT));
                } catch (Exception ignored) {}
            }

            long deadline = System.currentTimeMillis() + Math.max(300, timeoutMs);
            byte[] buf = new byte[1024];
            while (System.currentTimeMillis() < deadline) {
                DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                try {
                    ds.receive(pkt);
                    String body = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8).trim();
                    JSONObject obj = new JSONObject(body);
                    String ip = pkt.getAddress() != null ? pkt.getAddress().getHostAddress() : obj.optString("ip", "");
                    if (ip == null || ip.isEmpty() || "127.0.0.1".equals(ip)) continue;
                    int port = obj.optInt("port", DEFAULT_PORT);
                    JSONObject entry = new JSONObject();
                    entry.put("ip", ip);
                    entry.put("port", port);
                    entry.put("url", "ws://" + ip + ":" + port + "/ws");
                    entry.put("name", obj.optString("name", ip));
                    entry.put("lobbies", obj.optInt("lobbies", 0));
                    found.put(ip + ":" + port, entry);
                } catch (java.net.SocketTimeoutException ignored) {
                    break;
                } catch (IOException ignored) {
                    break;
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}

        JSONArray arr = new JSONArray();
        for (JSONObject item : found.values()) arr.put(item);
        return arr;
    }

    private void discoveryLoop() {
        try (DatagramSocket ds = new DatagramSocket(null)) {
            ds.setReuseAddress(true);
            ds.bind(new InetSocketAddress("0.0.0.0", DISCOVERY_PORT));
            discoverySocket = ds;
            byte[] buf = new byte[512];
            while (running) {
                DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                ds.receive(pkt);
                String text = new String(pkt.getData(), 0, pkt.getLength(), StandardCharsets.UTF_8).trim();
                if (DISCOVER_QUERY.equals(text)) {
                    JSONObject info = new JSONObject();
                    info.put("name", Build.MODEL != null ? Build.MODEL + " (Phone)" : "Android Host");
                    info.put("port", boundPort);
                    info.put("clients", clients.size());
                    info.put("lobbies", rooms.size());
                    byte[] resp = info.toString().getBytes(StandardCharsets.UTF_8);
                    ds.send(new DatagramPacket(resp, resp.length, pkt.getAddress(), pkt.getPort()));
                }
            }
        } catch (Exception ignored) {}
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket sock = serverSocket.accept();
                sock.setTcpNoDelay(true);
                Thread handler = new Thread(() -> handleConnection(sock), "ShatteredCrown-LAN-Client");
                handler.setDaemon(true);
                handler.start();
            } catch (IOException ignored) {
                if (!running) break;
            }
        }
    }

    private void handleConnection(Socket socket) {
        Client wsClient = null;
        try {
            InputStream rawIn = new BufferedInputStream(socket.getInputStream());
            OutputStream out = socket.getOutputStream();
            List<String> headerLines = readHttpHeaders(rawIn);
            if (headerLines.isEmpty()) {
                socket.close();
                return;
            }

            String requestLine = headerLines.get(0);
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0].toUpperCase(Locale.ROOT) : "GET";
            String rawTarget = parts.length > 1 ? parts[1] : "/";

            Map<String, String> headers = new LinkedHashMap<>();
            for (int i = 1; i < headerLines.size(); i++) {
                int colon = headerLines.get(i).indexOf(':');
                if (colon > 0) {
                    headers.put(
                        headerLines.get(i).substring(0, colon).trim().toLowerCase(Locale.ROOT),
                        headerLines.get(i).substring(colon + 1).trim()
                    );
                }
            }

            if ("websocket".equalsIgnoreCase(headers.get("upgrade")) && headers.containsKey("sec-websocket-key")) {
                String wsKey = headers.get("sec-websocket-key");
                MessageDigest sha1 = MessageDigest.getInstance("SHA-1");
                byte[] digest = sha1.digest((wsKey + WS_GUID).getBytes(StandardCharsets.UTF_8));
                String accept = Base64.encodeToString(digest, Base64.NO_WRAP);

                String handshake = "HTTP/1.1 101 Switching Protocols\r\n"
                    + "Upgrade: websocket\r\n"
                    + "Connection: Upgrade\r\n"
                    + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
                out.write(handshake.getBytes(StandardCharsets.UTF_8));
                out.flush();

                String clientIp = socket.getInetAddress() != null ? socket.getInetAddress().getHostAddress() : "127.0.0.1";
                if (clientIp != null && clientIp.startsWith("::ffff:")) clientIp = clientIp.substring(7);
                wsClient = new Client("c_" + (nextClientId++), clientIp != null ? clientIp : "127.0.0.1", socket, out);
                clients.put(wsClient.id, wsClient);

                JSONObject welcome = new JSONObject();
                welcome.put("type", "welcome");
                welcome.put("id", wsClient.id);
                welcome.put("ip", wsClient.ip);
                sendWsJson(wsClient, welcome);

                runWsLoop(wsClient, new DataInputStream(rawIn));
                return;
            }

            serveHttpAsset(method, rawTarget, out);
        } catch (Exception ignored) {
        } finally {
            if (wsClient != null) {
                clients.remove(wsClient.id);
                removeClientFromRoom(wsClient);
            }
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }

    private static List<String> readHttpHeaders(InputStream in) throws IOException {
        ByteArrayOutputStream lineBuf = new ByteArrayOutputStream();
        List<String> lines = new ArrayList<>();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\r') continue;
            if (b == '\n') {
                String line = lineBuf.toString("UTF-8");
                lineBuf.reset();
                if (line.isEmpty()) break;
                lines.add(line);
                if (lines.size() > 64) break;
            } else {
                lineBuf.write(b);
                if (lineBuf.size() > 8192) break;
            }
        }
        return lines;
    }

    private void serveHttpAsset(String method, String rawTarget, OutputStream out) throws IOException {
        String cleanUrl = rawTarget.split("\\?")[0];
        if ("/health".equals(cleanUrl)) {
            JSONObject obj = new JSONObject();
            try {
                obj.put("ok", true);
                obj.put("lan", true);
                obj.put("clients", clients.size());
                obj.put("lobbies", rooms.size());
            } catch (Exception ignored) {}
            byte[] body = obj.toString().getBytes(StandardCharsets.UTF_8);
            writeHttpResponse(out, 200, "OK", "application/json; charset=utf-8", body, "HEAD".equals(method));
            return;
        }
        if ("/api/lan-info".equals(cleanUrl)) {
            JSONObject obj = new JSONObject();
            try {
                String ip = getLocalLanIp();
                JSONArray ips = new JSONArray();
                JSONArray urls = new JSONArray();
                if (ip != null && !ip.isEmpty() && !"127.0.0.1".equals(ip)) {
                    ips.put(ip);
                    urls.put("ws://" + ip + ":" + boundPort + "/ws");
                }
                obj.put("ok", true);
                obj.put("port", boundPort);
                obj.put("ips", ips);
                obj.put("urls", urls);
            } catch (Exception ignored) {}
            byte[] body = obj.toString().getBytes(StandardCharsets.UTF_8);
            writeHttpResponse(out, 200, "OK", "application/json; charset=utf-8", body, "HEAD".equals(method));
            return;
        }

        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            writeHttpResponse(out, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method Not Allowed".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        String rel = URLDecoder.decode(cleanUrl, "UTF-8").replaceFirst("^/+", "");
        if (rel.isEmpty()) rel = "index.html";
        if (rel.contains("..")) {
            writeHttpResponse(out, 400, "Bad Request", "text/plain; charset=utf-8", "Bad Request".getBytes(StandardCharsets.UTF_8), false);
            return;
        }

        byte[] data = readAssetBytes("public/" + rel);
        if (data == null && !rel.endsWith(".html")) {
            data = readAssetBytes("public/" + rel + "/index.html");
            if (data != null) rel = rel + "/index.html";
        }
        if (data == null) {
            writeHttpResponse(out, 404, "Not Found", "text/plain; charset=utf-8", "Not Found".getBytes(StandardCharsets.UTF_8), false);
            return;
        }
        writeHttpResponse(out, 200, "OK", guessMimeType(rel), data, "HEAD".equals(method));
    }

    private byte[] readAssetBytes(String assetPath) {
        AssetManager am = appContext.getAssets();
        try (InputStream is = am.open(assetPath)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    private static void writeHttpResponse(OutputStream out, int code, String status, String mime, byte[] body, boolean headOnly) throws IOException {
        String headers = "HTTP/1.1 " + code + " " + status + "\r\n"
            + "Content-Type: " + mime + "\r\n"
            + "Content-Length: " + body.length + "\r\n"
            + "Cache-Control: no-store\r\n"
            + "Access-Control-Allow-Origin: *\r\n"
            + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        if (!headOnly && body.length > 0) out.write(body);
        out.flush();
    }

    private static String guessMimeType(String path) {
        String low = path.toLowerCase(Locale.ROOT);
        if (low.endsWith(".html")) return "text/html; charset=utf-8";
        if (low.endsWith(".js") || low.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (low.endsWith(".css")) return "text/css; charset=utf-8";
        if (low.endsWith(".png")) return "image/png";
        if (low.endsWith(".jpg") || low.endsWith(".jpeg")) return "image/jpeg";
        if (low.endsWith(".svg")) return "image/svg+xml";
        if (low.endsWith(".webp")) return "image/webp";
        if (low.endsWith(".json")) return "application/json; charset=utf-8";
        if (low.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
        if (low.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private void runWsLoop(Client client, DataInputStream in) throws IOException {
        while (running && !client.socket.isClosed()) {
            int b0;
            try {
                b0 = in.readUnsignedByte();
            } catch (EOFException eof) {
                break;
            }
            int b1 = in.readUnsignedByte();
            int opcode = b0 & 0x0F;
            boolean masked = (b1 & 0x80) != 0;
            long len = b1 & 0x7F;
            if (len == 126) {
                len = in.readUnsignedShort();
            } else if (len == 127) {
                len = in.readLong();
            }
            if (len < 0 || len > 262144) break;

            byte[] mask = new byte[4];
            if (masked) in.readFully(mask);
            byte[] payload = new byte[(int) len];
            if (len > 0) in.readFully(payload);
            if (masked) {
                for (int i = 0; i < payload.length; i++) {
                    payload[i] = (byte) (payload[i] ^ mask[i & 3]);
                }
            }

            if (opcode == 0x8) {
                break;
            } else if (opcode == 0x9) {
                sendRawFrame(client, 0xA, payload);
            } else if (opcode == 0x1) {
                try {
                    JSONObject msg = new JSONObject(new String(payload, StandardCharsets.UTF_8));
                    handleClientMessage(client, msg);
                } catch (Exception ignored) {}
            }
        }
    }

    private static void sendRawFrame(Client client, int opcode, byte[] payload) {
        if (client == null || client.socket.isClosed()) return;
        try {
            synchronized (client.out) {
                int len = payload.length;
                if (len < 126) {
                    client.out.write(0x80 | opcode);
                    client.out.write(len);
                } else if (len < 65536) {
                    client.out.write(0x80 | opcode);
                    client.out.write(126);
                    client.out.write((len >> 8) & 0xFF);
                    client.out.write(len & 0xFF);
                } else {
                    return;
                }
                client.out.write(payload);
                client.out.flush();
            }
        } catch (IOException ignored) {}
    }

    private static void sendWsJson(Client client, JSONObject obj) {
        sendRawFrame(client, 0x1, obj.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String hashPassword(String pw) {
        if (pw == null || pw.isEmpty()) return "";
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(pw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return pw;
        }
    }

    private JSONObject serializeRoomFor(Room r, String viewerIp) {
        JSONObject obj = new JSONObject();
        try {
            PlayerSlot host = r.players.isEmpty() ? null : r.players.get(0);
            obj.put("id", r.id);
            obj.put("name", r.name);
            obj.put("mapId", r.mapId);
            obj.put("hasPassword", !r.passwordHash.isEmpty());
            obj.put("playerCount", r.players.size());
            obj.put("maxPlayers", 2);
            obj.put("status", r.status);
            obj.put("hostName", host != null ? host.heroName : "Challenger");
            obj.put("hostClass", host != null ? host.heroClass : "paladin");
            obj.put("sameNetwork", true);
        } catch (Exception ignored) {}
        return obj;
    }

    private static String normalizeVer(String v) {
        if (v == null) return "unknown";
        String clean = v.replaceFirst("(?i)^v\\.?", "").trim();
        return clean.isEmpty() ? "unknown" : clean;
    }

    private static boolean hasVersionMismatch(Room r) {
        if (r == null || r.players.size() < 2) return false;
        return !normalizeVer(r.players.get(0).appVersion).equals(normalizeVer(r.players.get(1).appVersion));
    }

    private JSONObject serializeRoomDetail(Room r) {
        JSONObject obj = new JSONObject();
        try {
            obj.put("id", r.id);
            obj.put("name", r.name);
            obj.put("mapId", r.mapId);
            obj.put("hasPassword", !r.passwordHash.isEmpty());
            obj.put("status", r.status);
            obj.put("round", r.round);
            obj.put("versionMismatch", hasVersionMismatch(r));
            int autoSec = r.autoStartAt > 0 ? Math.max(0, (int) Math.ceil((r.autoStartAt - System.currentTimeMillis()) / 1000.0)) : 0;
            obj.put("autoStartSec", autoSec);
            JSONArray sc = new JSONArray();
            sc.put(r.scores[0]);
            sc.put(r.scores[1]);
            obj.put("scores", sc);
            JSONArray pls = new JSONArray();
            for (int i = 0; i < r.players.size(); i++) {
                PlayerSlot pl = r.players.get(i);
                JSONObject pObj = new JSONObject();
                pObj.put("id", pl.id);
                pObj.put("slot", i);
                pObj.put("isHost", i == 0);
                pObj.put("heroName", pl.heroName);
                pObj.put("heroClass", pl.heroClass);
                pObj.put("appVersion", pl.appVersion);
                pObj.put("loadout", pl.loadout != null ? pl.loadout : JSONObject.NULL);
                pObj.put("ready", pl.ready);
                pls.put(pObj);
            }
            obj.put("players", pls);
        } catch (Exception ignored) {}
        return obj;
    }

    private void broadcastLobbies() {
        for (Client c : clients.values()) {
            sendLobbiesTo(c);
        }
    }

    private void sendLobbiesTo(Client c) {
        JSONArray list = new JSONArray();
        for (Room r : rooms.values()) {
            synchronized (r) {
                if ("lobby".equals(r.status) && r.players.size() < 2) {
                    list.put(serializeRoomFor(r, c.ip));
                }
            }
        }
        try {
            JSONObject msg = new JSONObject();
            msg.put("type", "lobbies");
            msg.put("lobbies", list);
            sendWsJson(c, msg);
        } catch (Exception ignored) {}
    }

    private void broadcastRoomUpdate(Room r) {
        JSONObject detail = serializeRoomDetail(r);
        try {
            JSONObject msg = new JSONObject();
            msg.put("type", "lobby_update");
            msg.put("room", detail);
            for (PlayerSlot pl : r.players) {
                sendWsJson(pl.client, msg);
            }
        } catch (Exception ignored) {}
    }

    private void removeClientFromRoom(Client c) {
        String rid = c.roomId;
        if (rid == null) return;
        c.roomId = null;
        Room r = rooms.get(rid);
        if (r == null) return;

        synchronized (r) {
            boolean wasPlaying = "playing".equals(r.status);
            Iterator<PlayerSlot> it = r.players.iterator();
            while (it.hasNext()) {
                if (it.next().id.equals(c.id)) it.remove();
            }
            if (r.roundTimer != null) {
                r.roundTimer.cancel(false);
                r.roundTimer = null;
            }
            clearAutoStart(r);
            if (r.players.isEmpty()) {
                rooms.remove(r.id);
            } else {
                r.status = "lobby";
                r.hostIp = r.players.get(0).client.ip;
                r.players.get(0).ready = false;
                if (wasPlaying) {
                    try {
                        JSONObject msg = new JSONObject();
                        msg.put("type", "opponent_left");
                        msg.put("room", serializeRoomDetail(r));
                        sendWsJson(r.players.get(0).client, msg);
                    } catch (Exception ignored) {}
                } else {
                    broadcastRoomUpdate(r);
                }
            }
        }
        broadcastLobbies();
    }

    private static void clearAutoStart(Room r) {
        if (r == null) return;
        if (r.autoStartTimer != null) {
            r.autoStartTimer.cancel(false);
            r.autoStartTimer = null;
        }
        r.autoStartAt = 0L;
    }

    private void finishRound(Room r, int winnerIdx, String reason) {
        if (r == null || !"playing".equals(r.status) || r.roundEnded || r.players.size() < 2) return;
        r.roundEnded = true;
        if (winnerIdx == 0 || winnerIdx == 1) {
            r.scores[winnerIdx] += 1;
        }

        JSONArray sc = new JSONArray();
        sc.put(r.scores[0]);
        sc.put(r.scores[1]);

        if (winnerIdx >= 0 && r.scores[winnerIdx] >= 2) {
            for (PlayerSlot pl : r.players) {
                try {
                    JSONObject over = new JSONObject();
                    over.put("type", "match_over");
                    over.put("winnerSlot", winnerIdx);
                    over.put("scores", sc);
                    over.put("round", r.round);
                    over.put("reason", reason);
                    sendWsJson(pl.client, over);
                } catch (Exception ignored) {}
            }
            r.status = "lobby";
            for (PlayerSlot pl : r.players) {
                pl.ready = false;
                pl.lastHp = 5000;
            }
            if (scheduler != null) {
                r.roundTimer = scheduler.schedule(() -> {
                    synchronized (r) {
                        if (rooms.containsKey(r.id)) broadcastRoomUpdate(r);
                    }
                }, 600, TimeUnit.MILLISECONDS);
            }
            broadcastLobbies();
        } else {
            for (PlayerSlot pl : r.players) {
                try {
                    JSONObject ro = new JSONObject();
                    ro.put("type", "round_over");
                    ro.put("winnerSlot", winnerIdx);
                    ro.put("isDraw", winnerIdx < 0);
                    ro.put("scores", sc);
                    ro.put("round", r.round);
                    ro.put("reason", reason);
                    sendWsJson(pl.client, ro);
                } catch (Exception ignored) {}
            }
            r.round += 1;
            if (scheduler != null) {
                r.roundTimer = scheduler.schedule(() -> {
                    synchronized (r) {
                        if (!rooms.containsKey(r.id) || r.players.size() < 2) return;
                        r.roundEnded = false;
                        for (PlayerSlot pl : r.players) pl.lastHp = 5000;
                        JSONObject detail = serializeRoomDetail(r);
                        for (int i = 0; i < r.players.size(); i++) {
                            try {
                                JSONObject nxt = new JSONObject();
                                nxt.put("type", "next_round");
                                nxt.put("slot", i);
                                nxt.put("room", detail);
                                sendWsJson(r.players.get(i).client, nxt);
                            } catch (Exception ignored) {}
                        }
                    }
                }, 2400, TimeUnit.MILLISECONDS);
            }
        }
    }

    private void launchRoomMatch(Room r) {
        clearAutoStart(r);
        r.status = "playing";
        r.round = 1;
        r.roundEnded = false;
        r.scores[0] = 0;
        r.scores[1] = 0;
        for (PlayerSlot pl : r.players) pl.lastHp = 5000;
        JSONObject detail = serializeRoomDetail(r);
        for (int i = 0; i < r.players.size(); i++) {
            try {
                JSONObject start = new JSONObject();
                start.put("type", "match_start");
                start.put("slot", i);
                start.put("room", detail);
                sendWsJson(r.players.get(i).client, start);
            } catch (Exception ignored) {}
        }
        broadcastLobbies();
    }

    private synchronized void handleClientMessage(Client client, JSONObject msg) {
        String type = msg.optString("type", "");
        if (type.isEmpty()) return;

        if ("ping".equals(type)) {
            try {
                JSONObject pong = new JSONObject();
                pong.put("type", "pong");
                pong.put("t", msg.opt("t"));
                sendWsJson(client, pong);
            } catch (Exception ignored) {}
            return;
        }

        if ("list_lobbies".equals(type)) {
            sendLobbiesTo(client);
            return;
        }

        if ("create_lobby".equals(type)) {
            removeClientFromRoom(client);
            String id = "lan_" + (nextRoomNum++) + "_" + UUID.randomUUID().toString().substring(0, 4);
            String heroName = msg.optString("heroName", "Sir Aldric").trim();
            if (heroName.isEmpty()) heroName = "Sir Aldric";
            if (heroName.length() > 20) heroName = heroName.substring(0, 20);
            String name = msg.optString("name", heroName + "'s LAN").trim();
            if (name.isEmpty()) name = "LAN Arena";
            if (name.length() > 28) name = name.substring(0, 28);
            int mapId = Math.max(0, Math.min(3, msg.optInt("mapId", 0)));
            String pwHash = hashPassword(msg.optString("password", ""));
            String heroClass = msg.optString("heroClass", "gilded");
            if (!"mage".equals(heroClass) && !"gilded".equals(heroClass) && !"ranger".equals(heroClass)) heroClass = "gilded";
            String appVersion = msg.optString("appVersion", "unknown").trim();
            JSONArray loadout = msg.optJSONArray("loadout");

            Room r = new Room(id, name, mapId, pwHash, client.ip);
            r.players.add(new PlayerSlot(client.id, client, heroName, heroClass, appVersion, loadout));
            rooms.put(id, r);
            client.roomId = id;
            try {
                JSONObject res = new JSONObject();
                res.put("type", "lobby_joined");
                res.put("slot", 0);
                res.put("room", serializeRoomDetail(r));
                sendWsJson(client, res);
            } catch (Exception ignored) {}
            broadcastLobbies();
            return;
        }

        if ("join_lobby".equals(type)) {
            Room r = rooms.get(msg.optString("roomId", ""));
            if (r == null) {
                sendError(client, null, "Lobby no longer exists.");
                return;
            }
            synchronized (r) {
                if (!"lobby".equals(r.status) || r.players.size() >= 2) {
                    sendError(client, null, "Lobby is already full or in a match.");
                    return;
                }
                if (!r.passwordHash.isEmpty() && !hashPassword(msg.optString("password", "")).equals(r.passwordHash)) {
                    sendError(client, "bad_password", "Incorrect room password.");
                    return;
                }
                removeClientFromRoom(client);
                String heroName = msg.optString("heroName", "Challenger").trim();
                if (heroName.isEmpty()) heroName = "Challenger";
                if (heroName.length() > 20) heroName = heroName.substring(0, 20);
                String heroClass = msg.optString("heroClass", "gilded");
                if (!"mage".equals(heroClass) && !"gilded".equals(heroClass) && !"ranger".equals(heroClass)) heroClass = "gilded";
                String appVersion = msg.optString("appVersion", "unknown").trim();
                JSONArray loadout = msg.optJSONArray("loadout");
                r.players.add(new PlayerSlot(client.id, client, heroName, heroClass, appVersion, loadout));
                client.roomId = r.id;
                try {
                    JSONObject res = new JSONObject();
                    res.put("type", "lobby_joined");
                    res.put("slot", 1);
                    res.put("room", serializeRoomDetail(r));
                    sendWsJson(client, res);
                } catch (Exception ignored) {}
                broadcastRoomUpdate(r);
            }
            broadcastLobbies();
            return;
        }

        if ("leave_lobby".equals(type)) {
            removeClientFromRoom(client);
            try {
                JSONObject left = new JSONObject();
                left.put("type", "lobby_left");
                sendWsJson(client, left);
            } catch (Exception ignored) {}
            return;
        }

        Room r = client.roomId != null ? rooms.get(client.roomId) : null;
        if (r == null) return;
        synchronized (r) {
            int pIdx = -1;
            for (int i = 0; i < r.players.size(); i++) {
                if (r.players.get(i).id.equals(client.id)) {
                    pIdx = i;
                    break;
                }
            }
            if (pIdx < 0) return;

            if ("update_player".equals(type)) {
                PlayerSlot pl = r.players.get(pIdx);
                if (msg.has("heroName")) {
                    String hn = msg.optString("heroName", pl.heroName).trim();
                    if (!hn.isEmpty()) pl.heroName = hn.length() > 20 ? hn.substring(0, 20) : hn;
                }
                if (msg.has("heroClass")) {
                    String hc = msg.optString("heroClass", pl.heroClass);
                    if ("mage".equals(hc) || "gilded".equals(hc) || "ranger".equals(hc)) pl.heroClass = hc;
                }
                if (msg.has("appVersion")) {
                    String av = msg.optString("appVersion", "").trim();
                    if (!av.isEmpty()) pl.appVersion = av;
                }
                if (msg.has("loadout")) pl.loadout = msg.optJSONArray("loadout");
                if (msg.has("ready")) pl.ready = msg.optBoolean("ready", pl.ready);
                if (pIdx == 0 && msg.has("mapId")) {
                    r.mapId = Math.max(0, Math.min(3, msg.optInt("mapId", r.mapId)));
                }
                boolean allReady = "lobby".equals(r.status) && r.players.size() == 2 && r.players.get(0).ready && r.players.get(1).ready && !hasVersionMismatch(r);
                if (allReady && r.autoStartTimer == null && scheduler != null) {
                    r.autoStartAt = System.currentTimeMillis() + 3200L;
                    r.autoStartTimer = scheduler.schedule(() -> {
                        synchronized (r) {
                            if (rooms.containsKey(r.id) && "lobby".equals(r.status) && r.players.size() == 2 && r.players.get(0).ready && r.players.get(1).ready && !hasVersionMismatch(r)) {
                                launchRoomMatch(r);
                            } else {
                                clearAutoStart(r);
                            }
                        }
                    }, 3200L, TimeUnit.MILLISECONDS);
                } else if (!allReady) {
                    clearAutoStart(r);
                }
                broadcastRoomUpdate(r);
                broadcastLobbies();
                return;
            }

            if ("start_match".equals(type) && pIdx == 0) {
                if (r.players.size() < 2) {
                    sendError(client, null, "Waiting for a challenger to join!");
                    return;
                }
                if (hasVersionMismatch(r)) {
                    sendError(client, "version_mismatch", "Game version didn't match! Please update the game before starting.");
                    return;
                }
                for (PlayerSlot pl : r.players) {
                    if (!pl.ready) {
                        sendError(client, null, "Both fighters must press Ready first!");
                        return;
                    }
                }
                launchRoomMatch(r);
                return;
            }

            if ("round_lost".equals(type)) {
                if (msg.has("round") && msg.optInt("round", r.round) != r.round) return;
                finishRound(r, pIdx == 0 ? 1 : 0, "ko");
                return;
            }

            if ("round_timeout".equals(type)) {
                if (msg.has("round") && msg.optInt("round", r.round) != r.round) return;
                if (!"playing".equals(r.status) || r.roundEnded || r.players.size() < 2) return;
                int hp0 = r.players.get(0).lastHp;
                int hp1 = r.players.get(1).lastHp;
                int winnerIdx = hp0 == hp1 ? -1 : (hp0 > hp1 ? 0 : 1);
                finishRound(r, winnerIdx, "timeout");
                return;
            }

            if ("pvp_sync".equals(type) && msg.has("hp")) {
                if (msg.has("round") && msg.optInt("round", r.round) != r.round) return;
                PlayerSlot cur = r.players.get(pIdx);
                cur.lastHp = Math.max(0, msg.optInt("hp", cur.lastHp));
                if ("playing".equals(r.status) && !r.roundEnded && cur.lastHp <= 0) {
                    finishRound(r, pIdx == 0 ? 1 : 0, "ko");
                }
            }

            if (r.players.size() >= 2) {
                PlayerSlot peer = r.players.get(pIdx == 0 ? 1 : 0);
                try {
                    JSONObject fwd = new JSONObject(msg.toString());
                    fwd.put("fromSlot", pIdx);
                    sendWsJson(peer.client, fwd);
                } catch (Exception ignored) {}
            }
        }
    }

    private static void sendError(Client client, String code, String message) {
        try {
            JSONObject err = new JSONObject();
            err.put("type", "error");
            if (code != null) err.put("code", code);
            err.put("message", message);
            sendWsJson(client, err);
        } catch (Exception ignored) {}
    }
}
