var config = require('./config');
var starterConfig = require('./starter_cfg');
const auf_users = new Map(); 
var bunList = new Map();
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var probe = require('@pm2/io');
probe.init({ metrics: {network: { traffic: true, ports: false }, deepMetrics: {socketio: true, redis: false, http: true, https: true, "http-outbound": true, "https-outbound": true}}});
var cur_socketid = "";
var cur_ip = "";
var data;

var serverId = crypto.createHash('md5').update(os.hostname()).update(process.cwd()).digest('hex');
var pm2 = require('pm2');
var httpsServer = {};
var io = {};

var ServerDate = new Date();
const htmlEscape = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' };
const { Pool } = require('pg');
const pool = new Pool(starterConfig.pgconf);
const socketioVersion = require("socket.io/package").version;
const inspector = require('inspector');

pm2.connect(function (err) {
    if (err) {
        console.error(JSON.stringify({message: err, timestamp: new Date(), type: 'err', process_id: process.env.NODE_APP_INSTANCE, app_name: 'push0k'}));
        process.exit(2);
    }
});

if (!config.https) {
    var httpServer = require('http').createServer().listen(config.port);
    io = require('socket.io')(httpServer, { pingInterval: config.pingInterval, pingTimeout: config.pingTimeout });
} else {
    var tls = require('tls');
    if (config.rejectUnauthorized) {
        var certs = {};
        certs[config.hostname] = { secureProtocol: "TLSv1_2_method", key: fs.readFileSync(config.catalog + "\\" + config.key), cert: fs.readFileSync(config.catalog + "\\" + config.cert), ca: fs.readFileSync(config.catalog + "\\" + config.ca), requestCert: config.requestCert, rejectUnauthorized: config.rejectUnauthorized };
        var httpsOptions = { SNICallback: function (hostname, cb) { var ctx = tls.createSecureContext(certs[hostname]); cb(null, ctx); } };
        httpsServer = require('https').createServer(httpsOptions);
    } else {
        if (config.ca != '') {
            httpsServer = require('https').createServer({ key: fs.readFileSync(config.key), cert: fs.readFileSync(config.cert), ca: fs.readFileSync(config.ca), requestCert: true, rejectUnauthorized: config.rejectUnauthorized });
        } else {
            httpsServer = require('https').createServer({ key: fs.readFileSync(config.key), cert: fs.readFileSync(config.cert), requestCert: false, rejectUnauthorized: config.rejectUnauthorized });
        }
    }
    httpsServer.listen(config.port, { wsEngine: config.wsEngine });
    io = require('socket.io')(httpsServer, { pingInterval: config.pingInterval, pingTimeout: config.pingTimeout });
}

function new_uuid() {
    return crypto.randomBytes(16).toString("hex");
}

async function pgquery(textquery, paramsarr) {

    try {
        const result = await pool.query(textquery, paramsarr);
        return result.rows;
    } catch (err) {
        return caughtErr(err, textquery, paramsarr);
    }

}

function caughtErr(description, err, errobj) {
    if (config.writelogerrfiles) {
        console.error(JSON.stringify({message: description + err + errobj, timestamp: new Date(), type: 'err', process_id: process.env.NODE_APP_INSTANCE, app_name: 'push0k'}));
    }
    let user = {};
    let UserId = "00000000-0000-0000-0000-000000000000";
    let BaseId = null;
    let Info = "";
    if (auf_users.has(cur_socketid)) {
        user = auf_users.get(cur_socketid);
        UserId = user.userid;
        BaseId = user.baseid;
        Info = user.info;
    }
    if (config.writelogerrtable) {

        pool.query("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, conid) VALUES (current_timestamp, $1, $2::uuid, $3, $4, $5::uuid, $6);",
            [3, new_uuid(), "Ошибка!!! " + description + "\r\n Ошибка: " + err + (errobj == "" ? "" : "\r\n" + errobj), cur_ip, UserId, cur_socketid], (err) => {
                if (err) {
                    console.error(JSON.stringify({message: "Error errsave query: " + err + errobj, timestamp: new Date(), type: 'err', process_id: process.env.NODE_APP_INSTANCE, app_name: 'push0k'}));
                }
            });
    }
    if (config.errlogroom) {
        ServerDate = new Date;
        var mesid = new_uuid();
        mesid = mesid.substring(0, 8) + '-' + mesid.substring(8, 12) + '-' + mesid.substring(12, 16) + '-' + mesid.substring(16, 20) + '-' + mesid.substring(20, 32);
        var data = { event: "sendMessage", mesid: mesid, date: ServerDate.toISOString(), roomid: config.errlogroom, datatype: 3, userid: UserId, destid: null, message: encodeURIComponent(description + " <br> " + err + " <br> " + errobj), extdata: "", baseid: BaseId, devtype: 0, info: Info, parentid: "" };
        io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));

        pool.query("INSERT INTO messages (tmstamp, userid, destid, mesid, roomid, message, datatype, extdata, devtype,datasize, conid) \
                         VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, 0, $10); ",
            [ServerDate, data.userid, data.destid, data.mesid, data.roomid, decodeURIComponent(data.message), data.datatype, decodeURIComponent(data.extdata), data.devtype, cur_socketid], (err) => {
                if (err) {
                    console.error(JSON.stringify({message: "Error err add message query: " + err + errobj, timestamp: new Date(), type: 'err', process_id: process.env.NODE_APP_INSTANCE, app_name: 'push0k'}));
                }
            });
        sendAnotherProcess(data);
    }
}

function datasinc(data) {

    var usersquery = "SELECT * FROM (SELECT catusers.refid as userid, catusers.marked, catusers.number as code, catusers.description as name, catusers.icon as icon, catusers.usersign as sign,CASE WHEN usercontact.changestamp > catusers.changestamp THEN usercontact.changestamp ELSE catusers.changestamp END as changestamp, usercontact.description as description, usercontact.blocknotifications, usercontact.blockmessages FROM (SELECT userid, contactid, description, blocknotifications, blockmessages, changestamp  FROM users_contacts WHERE userid = $1::uuid) as usercontact LEFT JOIN userscat as catusers ON (usercontact.contactid = catusers.refid)) as users WHERE users.changestamp > $2::timestamptz";
    var roomsquery = "SELECT refid as roomid, marked, code, description as name,icon as icon, extdesc as description, roomtype, changestamp, users as users FROM public.roomscat WHERE refid IN (SELECT roomid as roomid FROM users_roomscat WHERE userid = $1::uuid) and  changestamp > $2::timestamptz;";
    var messquery = "SELECT messages.mesid as mesid,destid as destid, messages.userid as userid, roomid as roomid, tmstamp as date, datatype, datasize, message, extdata, devtype, coalesce(coninfo.info,'') as info, parentid, \
                            CASE WHEN (roomid IS NULL AND messages.userid = $1::uuid) THEN destid WHEN (roomid IS NULL AND destid = $1::uuid) THEN messages.userid ELSE roomid END as orfield, \
                            CASE WHEN messreaded.mesid IS NULL AND $1::uuid NOT IN (destid, messages.userid) THEN FALSE WHEN messreaded.readed = 0 THEN FALSE ELSE TRUE END as readed \
                        FROM messages LEFT JOIN (SELECT mesid, MAX(logtype) as readed FROM notifications WHERE tmstamp > $2::timestamptz AND userid = $1 AND logtype = 1 GROUP BY mesid) as messreaded ON (messages.mesid = messreaded.mesid)\
                        LEFT JOIN (SELECT connections.conid, devicecat.description || ' :  ' || basescat.description || ' (' || basescat.baseversion || ')' as info FROM connections LEFT JOIN devicecat ON (connections.usrdevid = devicecat.refid) LEFT JOIN basescat ON (connections.baseid = basescat.refid)) as coninfo ON (messages.conid = coninfo.conid)\
                        WHERE (roomid IN (SELECT roomid as roomid FROM users_roomscat WHERE userid = $1::uuid) OR $1::uuid IN (messages.userid,destid)) AND datatype != 6 AND tmstamp > $2::timestamptz ORDER BY orfield, date";

    var qmessparams = [data.userid, data.lastdatesinc];

    Promise.all([
        pgquery(usersquery, qmessparams),
        pgquery(roomsquery, qmessparams),
        pgquery("SELECT userid as userid,dateon,baseid,substr(conid,1,6) as id FROM public.connections WHERE dateoff IS NULL", []),
        pgquery(messquery, qmessparams)
    ]).then(qresults => {
        let user = auf_users.get(cur_socketid);
        var dataid = new_uuid();
        var curDate = new Date();
        var resultdata = '{"Users":' + JSON.stringify(qresults[0]) + ',"Rooms": ' + JSON.stringify(qresults[1]) + ',"joinedRooms": ' + JSON.stringify(user.rooms) + ',"Mess": ' + JSON.stringify(qresults[3]) + ',"Cons": ' + JSON.stringify(qresults[2]) + '}';
        var resultText = '{"event": "datasync", "userscount":' + qresults[0].length + ',"roomscount": ' + qresults[1].length + ',"messcount": ' + qresults[3].length + ',"conscount": ' + qresults[2].length + ',"data": "' + Buffer.from(resultdata).toString("base64") + '","dataid": "' + dataid + '","datesync": "' + curDate.toISOString() + '"}';

        var curDateInt = 62135596800000 + Date.now();
        io.sockets.connected[data.id].binary(false).emit("message", resultText);
        pgquery("INSERT INTO datasend (dataid, conid, starttime, endtime, timems, tmstamp, https, nodejsver, socketiover, datatype, filesize, serverid, filename) VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, 0, $8, $9, '');", [dataid, data.id, curDateInt, curDate, String(config.https ? true : false).toUpperCase(), process.versions.node, socketioVersion, Buffer.byteLength(resultText, 'utf8'), serverId]);
    }).catch(err => { caughtErr("uncaughtException ", err, JSON.stringify(data)); });

}

function dataDB(data) {

    var usersquery = "SELECT refid, marked, number, description, usersign, tmppwd, icon, userid, changestamp, code FROM public.userscat";
    var roomsquery = "SELECT refid, marked, code, description, icon, extdesc, roomtype, changestamp, users FROM public.roomscat";
    var basesquery = "SELECT refid, description, baseref, baseversion, code, marked, userid, changestamp FROM public.basescat;";
    var devicesquery = "SELECT refid, marked, code, description, platformtype, osversion, appversion, useragentinformation, processor, memory, servercore, servercpufrequency, servercpu, userid, changestamp, senderid	FROM public.devicecat;";
    var logsquery = "SELECT * FROM (SELECT logid, logtype, tmstamp, description, ipadress, userid, conid FROM public.logs ORDER BY tmstamp DESC LIMIT 300) as lastlogs ORDER BY tmstamp ASC;";
    var consquery = "SELECT userscat.description as user, connections.userid as userid, conid, dateon, dateoff, basescat.description || ' (' || basescat.baseversion || ')' as base, ipadress, devicecat.description as usrdev, contime, auftime, datasintime, pg_size_pretty(datasize) as datasize, https, procid, srvdevicecat.description as server, pg_size_pretty(bytesread) as bytesread, pg_size_pretty(byteswrite) as byteswrite, useragent FROM (\
                        SELECT userid, conid, dateon, dateoff, baseid, ipadress, usrdevid, contime, auftime, datasintime, datasize, https, procid, serverid, bytesread, byteswrite, useragent \
                            FROM public.connections ORDER BY dateon DESC LIMIT 300 ) as connections \
                    LEFT JOIN devicecat ON (connections.usrdevid = devicecat.refid) \
                    LEFT JOIN devicecat AS srvdevicecat ON (connections.serverid = srvdevicecat.refid)\
                    LEFT JOIN basescat ON (connections.baseid = basescat.refid)\
                    LEFT JOIN userscat ON (connections.userid = userscat.refid) ORDER BY dateon ASC";
    var datasendquery = "SELECT * FROM (SELECT tmstamp, filename, pg_size_pretty(filesize) as filesize, timems, speedmb, https, nodejsver, socketiover, datatype, upload, pg_size_pretty(diskfilesize) as diskfilesize FROM public.datasend WHERE datatype=0 ORDER BY tmstamp DESC LIMIT 300) as datasends ORDER BY tmstamp ASC;";
    var atachmentsquery = "SELECT * FROM (SELECT tmstamp, filename, pg_size_pretty(filesize) as filesize, timems, speedmb, https, nodejsver, socketiover, datatype, upload, pg_size_pretty(diskfilesize) as diskfilesize FROM public.datasend WHERE datatype!=0 ORDER BY tmstamp DESC LIMIT 300) as datasends ORDER BY tmstamp ASC;";
    var messagesquery = "SELECT tmstamp, userscat.description as user, destscat.description as dest, mesid, roomscat.description as room, message, datatype, extdata, devtype, datasize, conid, parentid FROM (SELECT tmstamp, userid, destid, mesid, roomid, message, datatype, extdata, devtype, datasize, conid, parentid FROM public.messages ORDER BY tmstamp DESC LIMIT 300) as messages \
                    LEFT JOIN userscat ON (messages.userid = userscat.refid) \
                    LEFT JOIN userscat AS destscat ON (messages.destid = destscat.refid) \
                    LEFT JOIN roomscat ON (messages.roomid = roomscat.refid) ORDER BY tmstamp ASC";
    var testsquery = "SELECT COALESCE(testdate, to_timestamp(objectstr->>'testdate', 'DD.MM.YYYY hh24:mi')::timestamptz) as testdate, COALESCE(extdata::uuid,savedres.refid) as testid, (objectstr->>'description')::text || ' сервер: ' || (objectstr->>'testserver')::text as description, objectstr ->> 'totalspeed' as totalspeed, objectstr FROM (SELECT extdata,MIN(tmstamp) as testdate FROM messages WHERE datatype=6  GROUP BY extdata) as testmes \
                        FULL JOIN (SELECT DISTINCT refid, objectstr FROM public.versions WHERE typeid = '0c15cf43-c8a2-2a7f-3c53-e2d3a86a0e62') AS savedres ON (testmes.extdata::uuid = savedres.refid) ORDER BY testdate DESC";                    
    
    var qmessparams = [];
    Promise.all([
        pgquery(usersquery, qmessparams),
        pgquery(roomsquery, qmessparams),
        pgquery(basesquery, qmessparams),
        pgquery(consquery, qmessparams),
        pgquery(logsquery, qmessparams),
        pgquery(devicesquery, qmessparams),
        pgquery(datasendquery, qmessparams),
        pgquery(atachmentsquery, qmessparams),
        pgquery(messagesquery, qmessparams),
        pgquery(testsquery, qmessparams)
    ]).then(qresults => {

        var dataid = new_uuid();
        var curDate = new Date();
        var resultdata = '{"Users":' + JSON.stringify(qresults[0]) + ',"Rooms": ' + JSON.stringify(qresults[1]) + ',"Bases": ' + JSON.stringify(qresults[2]) + ',"Connections": ' + JSON.stringify(qresults[3]) + ',"Logs": ' + JSON.stringify(qresults[4]) + ',"Devices": ' + JSON.stringify(qresults[5]) + ',"Datasend": ' + JSON.stringify(qresults[6]) + ',"Atachments": ' + JSON.stringify(qresults[7]) + ',"Messages": ' + JSON.stringify(qresults[8]) + ',"Tests": ' + JSON.stringify(qresults[9]) + '}';
        var resultText = '{"event": "dataDB", "userscount":' + qresults[0].length + ',"roomscount": ' + qresults[1].length + ',"conscount": ' + qresults[3].length + ',"logscount": ' + qresults[4].length + ',"data": "' + Buffer.from(resultdata).toString("base64") + '","dataid": "' + dataid + '","datesync": "' + curDate.toISOString() + '"}';

        var curDateInt = 62135596800000 + Date.now();
        io.sockets.connected[data.id].binary(false).emit("message", resultText);
        pgquery("INSERT INTO datasend (dataid, conid, starttime, endtime, timems, tmstamp, https, nodejsver, socketiover, datatype, filesize, serverid, filename) VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, 0, $8, $9, '');", [dataid, data.id, curDateInt, curDate, String(config.https ? true : false).toUpperCase(), process.versions.node, socketioVersion, Buffer.byteLength(resultText, 'utf8'), serverId]);
    }).catch(err => { caughtErr("uncaughtException ", err, JSON.stringify(data)); });
}

function dataDBupdated(data) {
    let textquery = "";
    if (data.type === "users") {
        textquery = "SELECT refid, marked, number, description, usersign, tmppwd, icon, userid, changestamp, code FROM public.userscat WHERE changestamp > $1::timestamptz";
    } else if (data.type === "rooms") {
        textquery = "SELECT refid, marked, code, description, icon, extdesc, roomtype, changestamp, users FROM public.roomscat WHERE changestamp > $1::timestamptz";
    } else if (data.type === "bases") {
        textquery = "SELECT refid, description, baseref, baseversion, code, marked, userid, changestamp FROM public.basescat WHERE changestamp > $1::timestamptz";
    } else if (data.type === "devices") {
        textquery = "SELECT refid, marked, code, description, platformtype, osversion, appversion, useragentinformation, processor, memory, servercore, servercpufrequency, servercpu, userid, changestamp, senderid FROM public.devicecat WHERE changestamp > $1::timestamptz";
    } else if (data.type === "messages") {
        textquery = "SELECT tmstamp, userscat.description as user, destscat.description as dest, mesid, roomscat.description as room, message, datatype, extdata, devtype, datasize, conid, parentid FROM public.messages \
        LEFT JOIN userscat ON (messages.userid = userscat.refid) \
        LEFT JOIN userscat AS destscat ON (messages.destid = destscat.refid) \
        LEFT JOIN roomscat ON (messages.roomid = roomscat.refid)  WHERE tmstamp > $1::timestamptz ORDER BY tmstamp ASC";
    } else if (data.type === "datasend") {
        textquery = "SELECT tmstamp, filename, pg_size_pretty(filesize) as filesize, timems, speedmb, https, nodejsver, socketiover, datatype, upload, pg_size_pretty(diskfilesize) as diskfilesize FROM public.datasend WHERE datatype=0 AND tmstamp > $1::timestamptz ORDER BY tmstamp ASC;";
    } else if (data.type === "atachments") {
        textquery = "SELECT tmstamp, filename, pg_size_pretty(filesize) as filesize, timems, speedmb, https, nodejsver, socketiover, datatype, upload, pg_size_pretty(diskfilesize) as diskfilesize FROM public.datasend WHERE datatype!=0 AND tmstamp > $1::timestamptz ORDER BY tmstamp ASC;";
    }
    var qmessparams = [data.date];
    pgquery(textquery, qmessparams).then(resultarr => {
        if (resultarr.length) {
            io.sockets.connected[data.id].binary(false).emit("message", '{"event": "dataDBupdated", "type": "' + data.type + '","data": "' + Buffer.from(JSON.stringify(resultarr)).toString("base64") + '"}');
        }
    }).catch(err => { caughtErr("uncaughtException ", err, JSON.stringify(data)); });
}

function statistic(data) {
    var statisticquery = "SELECT (SELECT count(*) FROM public.basescat) as bases, \
    (SELECT count(*) FROM public.userscat) as users, \
    (SELECT count(*) FROM public.roomscat) as rooms, \
    (SELECT count(*) FROM public.devicecat) as devices, \
    (SELECT count(*)	FROM public.notifications WHERE logtype = 0) as deliverymes, \
    (SELECT count(*)	FROM public.notifications WHERE logtype = 1) as readmes, \
    (SELECT reltuples::bigint AS estimate FROM pg_class where relname='messages') as messages, \
    (SELECT count(*) FROM public.messages WHERE datatype=6) as testmessages, \
    datasend.rowcount as datarows, pg_size_pretty(datasend.dsize) as datasize, datasend2.datadelivery, datasend2.dataspeed, pg_size_pretty(atachup.atachupsize) as upsize, atachup.upspeed, pg_size_pretty(atachdl.atachdlsize) as dlsize, atachdl.dlspeed \
        FROM (SELECT count(*) as rowcount, sum(filesize) as dsize FROM public.datasend WHERE datatype=0) as datasend, \
            (SELECT count(*) as datadelivery, max(speedmb) as dataspeed FROM public.datasend WHERE datatype=0 AND timems > 0) as datasend2, \
            (SELECT sum(diskfilesize) as atachupsize, max(speedmb) as upspeed FROM public.datasend WHERE datatype!=0 AND upload=true) as atachup, \
            (SELECT sum(diskfilesize) as atachdlsize, max(speedmb) as dlspeed FROM public.datasend WHERE datatype!=0 AND upload=false) as atachdl ";
    var statisticparams = [];
    pgquery(statisticquery, statisticparams).then(resultarr => {
        if (resultarr.length) {
            let result = resultarr[0];
            io.sockets.connected[data.id].binary(false).emit('message', '{"event": "statistic", "users": ' + result.users + ', "rooms": ' + result.rooms + ',"devices": ' + result.devices + ',"bases": ' + result.bases + ', "datarows": ' + result.datarows + ', "datadelivery": ' + result.datadelivery + ', "datasize": "' + result.datasize + '", "dataspeed": "' + result.dataspeed + '", "messages": ' + result.messages + ', "deliverymes": ' + result.deliverymes + ', "readmes": ' + result.readmes + ', "testmessages": ' + result.testmessages + ', "upsize": "' + result.upsize + '", "upspeed": "' + result.upspeed + '", "dlsize": "' + result.dlsize + '", "dlspeed": "' + result.dlspeed + '"}');
        }
    }).catch(err => { caughtErr('Error executing statistic query', err.stack, statisticquery + "   " + JSON.stringify(statisticparams)); });
}

function testresult(data) {
    var statisticquery = "SELECT EXTRACT(epoch FROM alldelivery/notifycount) as deliveryavg, EXTRACT(epoch FROM maxdelivery) as deliverymax, EXTRACT(epoch FROM mindelivery) as deliverymin, EXTRACT(epoch FROM maxmesdate-minmesdate) as mestime, EXTRACT(epoch FROM maxwritedate-mindeliverytime) as notifytime,EXTRACT(epoch FROM maxdeliverydate-minmesdate) as totaltime,EXTRACT(epoch FROM maxwritedate-minmesdate) as pgtime, maxdeliverydate, minmesdate, maxwritedate, mes1.mescount as mescount, notifycount, deliverycount, testmes.extdata as testdata, testmes.serverid as serverid, testmes.message as message FROM \
    (SELECT SUM(tmstamp - mes.date) AS alldelivery, MAX(tmstamp - mes.date) AS maxdelivery, MIN(tmstamp - mes.date) AS mindelivery, MAX(mes.date) AS maxmesdate, MIN(mes.date) AS minmesdate, MIN(tmstamp) AS mindeliverytime, MAX(tmstamp) AS maxwritedate, MAX(tmstamp) AS maxdeliverydate, count(1) as notifycount, count(1) as deliverycount FROM public.notifications as notif \
    INNER JOIN(SELECT mesid, tmstamp as date FROM public.messages WHERE extdata LIKE $1) AS mes ON mes.mesid = notif.mesid) AS notif1, \
    (SELECT count(1) as mescount FROM public.messages WHERE extdata LIKE $1) AS mes1, (SELECT message, extdata, serverid FROM public.messages LEFT JOIN public.connections ON connections.conid = messages.conid WHERE messages.mesid = $1) AS testmes ";
    var statisticparams = [data.testid];
    pgquery(statisticquery, statisticparams).then(resultarr => {
        if (resultarr.length) {
            let result = resultarr[0];
            io.sockets.connected[data.id].binary(false).emit('message', '{"event": "testResult", "testdata": ' + Buffer.from(JSON.stringify(result)).toString("base64") + '"}');
        }
    }).catch(err => { caughtErr('Error executing testresult query', err.stack, statisticquery + "   " + JSON.stringify(statisticparams)); });
}

function testresultsave(data) {
    var statisticquery = "INSERT INTO versions (stamptime, userid, typeid, refid, objectstr) VALUES (current_timestamp, $1::uuid, '0c15cf43-c8a2-2a7f-3c53-e2d3a86a0e62'::uuid, $2::uuid, $3) RETURNING *";
    var statisticparams = [data.userid, data.testid, JSON.parse(Buffer.from(data.testresult, 'base64').toString('utf8'))];
    pgquery(statisticquery, statisticparams).then(resultarr => {
        if (resultarr.length) {
            let result = resultarr[0];
            io.sockets.connected[data.id].binary(false).emit('message', '{"event": "savedTestResult", "testdata": ' + Buffer.from(JSON.stringify(result)).toString("base64") + '"}');
            pgquery("DELETE FROM notifications WHERE mesid IN(SELECT mesid FROM messages WHERE datatype=6 AND extdata=1$::uuid)", [data.testid]);
            pgquery("DELETE mesid FROM messages WHERE datatype=6 AND extdata=1$::uuid", [data.testid]);
        }
    }).catch(err => { caughtErr('Error executing testresult query', err.stack, statisticquery + "   " + JSON.stringify(statisticparams)); });
}

function log(logtype, description, userid, ipadress, usercode) {
    let qparams = [logtype, new_uuid(), description, ipadress, userid, cur_socketid, typeof usercode === 'undefined' ? null : usercode];
    pgquery("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, conid, usercode) VALUES (current_timestamp, $1, $2::uuid, $3, $4, $5, $6, $7) RETURNING *", qparams).then(resArr => {
        if (resArr.length) {
            resArr[0].description = encodeURIComponent(resArr[0].description);
            updateAdminClient('{"event":"addLogRow","data":' + JSON.stringify(resArr[0]) + '}');
            sendAnotherProcess({"event": "addLogRow","data": resArr[0]});
        }
    }).catch(err => { caughtErr('Error executing update log query', err.stack, "INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, conid) VALUES (current_timestamp, $1, $2::uuid, $3, $4, $5, $6);" + "   " + JSON.stringify(qparams)); });
}

process.on('uncaughtException', function (err) {
    caughtErr("uncaughtException ", err, JSON.stringify(data));
});

process.on('SIGINT', function () {

    let updatedata = "";
    for (let [key, user] of auf_users.entries()) {
        if (typeof io.sockets.connected[key] != 'undefined')
            updatedata += ", ('" + key + "'," + ", '" + user.userid + "'," + io.sockets.connected[key].request.client.bytesRead + "," + io.sockets.connected[key].request.client.bytesWritten + ")";
    }
    if (updatedata === "") {
        pool.end();
        process.exit(0);
        return;
    }
    pgquery("UPDATE connections SET dateoff = current_timestamp, bytesread = subquery.bytesread, byteswrite = subquery.byteswrite FROM (SELECT * FROM ( VALUES " + updatedata.substr(2) + " ) as subquery (conid, userid, bytesread, byteswrite)) as subquery WHERE dateoff IS NULL AND connections.conid = subquery.conid AND connections.userid = subquery.userid::uuid", [])
    .then(pool.end(), process.exit(0)).catch( pool.end(), process.exit(0));    

});

function savebase(baseid, baseref, basename, basever, userid) {

    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr("Error acquiring client ", err.stack, "");
        }

        baseref = decodeURIComponent(baseref);
        basename = decodeURIComponent(basename);
        basever = decodeURIComponent(basever);
        const result = await client.query("SELECT refid, description, baseref, baseversion FROM basescat WHERE refid = $1::uuid;", [baseid]);

        var querytext = "";
        var queryparams = [];
        if (result.rowCount) {
            querytext = "UPDATE basescat SET code=$1, baseversion=$2, userid=$3, changestamp=current_timestamp WHERE refid = $1::uuid and baseversion <> $2;";
            queryparams = [baseid, basever, userid];
        }
        else {
            querytext = "INSERT INTO basescat (refid, marked, code, description, baseref, baseversion, userid, changestamp) VALUES ($1::uuid,false,$1, $2,$3,$4,$5,current_timestamp);";
            queryparams = [baseid, basename, baseref, basever, userid];
        }

        await client.query(querytext, queryparams);
        release();
    });

}

function saveuserdev(clientid, ostype, osversion, appversion, proc, ram, compname, infappview, userid) {

    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr('Error acquiring client', err.stack, "");
        }

        proc = decodeURIComponent(proc);
        ostype = decodeURIComponent(ostype);
        osversion = decodeURIComponent(osversion);
        const result = await client.query("SELECT refid as devid FROM devicecat WHERE refid = $1;", [clientid]);
        var querytext = "";

        var queryparams = [clientid, false, clientid, compname, ostype, osversion, appversion, proc, ram * 1024 * 1024, userid];
        if (result.rowCount)
            querytext = "UPDATE devicecat SET code=$3::uuid, description=$4, platformtype=$5, osversion=$6, appversion=$7, processor=$8, memory=$9,servercore=0,servercpufrequency=0,servercpu='',userid=$10,changestamp=current_timestamp \
                                WHERE refid = $1 and (description <> $4 or marked <> $2 or platformtype <> $5 or osversion <> $6 or appversion <> $7 or processor <> $8 or memory <> $9);";
        else
            querytext = "INSERT INTO devicecat (refid, marked, code, description, platformtype, osversion, appversion, processor, memory,useragentinformation,servercore,servercpufrequency,servercpu,userid,changestamp) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,'',0,0,'',$10,current_timestamp);";

        await client.query(querytext, queryparams);
        release();
    });

}

function findUser(roomUsers, userid) {
    for (let i = 0; i < roomUsers.length; i++) {
        if (roomUsers[i].userid == userid)
            return true;
    }
    return false;
}

function checkRoomUsers(dataRoom) {
    auf_users.forEach((user, key) => {
        if (typeof io.sockets.connected[key] != 'undefined' && !(data.roomid in io.sockets.connected[key].rooms) && findUser(dataRoom.users, user.userid)) {
            io.sockets.connected[key].join(data.roomid);
            dataRoom.event = dataRoom.event + 'Join';
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
        } else if (typeof io.sockets.connected[key] != 'undefined' && data.roomid in io.sockets.connected[key].rooms && !(findUser(dataRoom.users, user.userid))) {
            io.sockets.connected[key].leave(data.roomid);
            dataRoom.event = dataRoom.event + 'Leave';
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
        } else if (typeof io.sockets.connected[key] != 'undefined' && data.roomid in io.sockets.connected[key].rooms)
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
    });
}

function sendAnotherProcess(data) {
    var mes = { type: 'process:msg', data: { message: data }, id: 0, topic: 'some topic' };
    for (let i = 0; i < config.proccount; i++) {
        if (i != process.env.NODE_APP_INSTANCE) {
            mes.id = i;
            pm2.sendDataToProcessId(mes, function (err) {
                if (err)
                    caughtErr('Ошибка отправки сообщения в другой процесс ', err, JSON.stringify(mes));
            });
        }
    }
}

function getProcessStatistic(socid) {
    pm2.list(function (err, processDescriptionList) {
        if (err) {
            return caughtErr('Ошибка получения статистики процессов', err.stack, "");
        }
        if (typeof io.sockets.connected[socid] != 'undefined') {
            io.sockets.connected[socid].binary(false).emit('message', '{"event": "ProcessStatistic","processDescriptionList": ' + getProcessInfo(processDescriptionList) + '}');
        }
    });
}

function getProcessInfo(processList) {
    var procarr = "[";
    for (let i = 0; i < processList.length; i++)
        procarr = procarr + (procarr == "[" ? "" : ",") + '{"name": "' + processList[i].name + '","pid":' + processList[i].pid + ',"pm_id":' + processList[i].pm_id + ',"memory":' + (processList[i].monit.memory / 1024 / 1024) + ',"cpu":' + processList[i].monit.cpu + ',"pm_uptime":' + processList[i].pm2_env.pm_uptime + ',"status":"' + processList[i].pm2_env.status + '","connections":' + (typeof processList[i].pm2_env.axm_monitor.connections == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.connections.value) + ',"net_ul":"' + (typeof processList[i].pm2_env.axm_monitor['Network In'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network In'].value) + '","net_dl":"' + (typeof processList[i].pm2_env.axm_monitor['Network Out'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network Out'].value) + '","HTTP":"' + (typeof processList[i].pm2_env.axm_monitor.HTTP == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.HTTP.value) + '", "deburl":"' + (typeof processList[i].pm2_env.axm_monitor.deburl == 'undefined' ? '' : processList[i].pm2_env.axm_monitor.deburl.value) + '", "errlogpath":"' + encodeURIComponent(processList[i].pm2_env.pm_err_log_path) + '"}';

    return procarr + ']';
}

function escapeHtml(string) {
    return String(string).replace(/[&<>"'`=\/]/g, function (s) {
        return htmlEscape[s];
    });
}

function codeColor(string) {
    var resultString;
    var strArr = String(string).split(/=1=/g);
    if (strArr.length > 1) {
        resultString = strArr[0];
        for (let i = 1; i < strArr.length; i++) {
            if (i % 2 != 0) {
                var codeStr = strArr[i];
                codeStr = codeStr.replace(/\"(?!\").+?\"/gm, '<span class=text>$&</span>');
                codeStr = codeStr.replace(/(?!<span[^>]*?>)(?![^<]*?<\/span>)(?!s*p*a*n*>)(\/\/.*$)/gm, "<span class=comments>$&</span>");
                codeStr = codeStr.replace(/(?!<span[^>]*?>)(?![^<]*?<\/span>)(?!s*p*a*n*>)(^\#.*$|^\&.*$)/gm, "<span class=directive>$&</span>");
                codeStr = codeStr.replace(/[/().=+\-;:\\*](?!<span[^>]*?>)(?![^<]*?<\/span>)(?!s*p*a*n*>)|((<|>)(?!<span[^>]*?>)(?![^<]*?\/span>)(?!s*p*a*n*[^>])|Если|Тогда|Цикл|Для|\bНе\b|\bПо\b|КонецЕсли|КонецФункции|КонецПроцедуры|Процедура|Функция|Цикл|ИначеЕсли|Новый|Экспорт|\bИ\b|КонецЦикла|Перем|Попытка|Исключение|КонецПопытки|Возврат|Продолжить|Неопределено|\bИз\b|Прервать)(?!<span[^>]*?>)(?![^<]*?<\/span>)(?!s*p*a*n*>)/gim, "<span class=operator>$&</span>");
                codeStr = codeStr.replace(/(?!<span[^>]*?>)(?![^<]*?<\/span>)(?!s*p*a*n*>)([\wа-яёА-ЯЁ]+)/gm, "<span class=variable>$&</span>");
                resultString = resultString + codeStr;
            } else
                resultString = resultString + escapeHtml(strArr[i]);
        }
    } else {
        return escapeHtml(string);
    }
    return resultString;
}

function replacetags(string, regexstr, symbstr, otag, ctag) {
    var resultString;
    var strArr = String(string).split(regexstr);
    if (strArr.length > 2) {
        resultString = strArr[0] + otag;
        for (let i = 1; i < strArr.length; i++) {
            if (i % 2 != 0) {
                if (otag == "<blockquote>") {
                    var quoteArr = String(strArr[i]).split(/<br>/gm);
                    if (quoteArr.length >= 2 && (quoteArr[0].length == 36 || quoteArr[0].length == 73)) {
                        var mesid = quoteArr[0];
                        var autor = quoteArr[1];
                        var quotetext = "";
                        for (let it = 2; it < quoteArr.length; it++) {
                            quotetext = quotetext + "\r\n" + quoteArr[it];
                        }
                        strArr[i] = '&#10075;&#10075;&nbsp;<a href="#' + mesid + '">' + autor + '</a><br>' + quotetext + '&nbsp;&#10076;&#10076;';
                    } else
                        strArr[i] = '&#10075;&#10075;&nbsp;<br>' + strArr[i] + '&nbsp;&#10076;&#10076;';
                }
                resultString = resultString + strArr[i] + (i == strArr.length - 1 ? '' : ctag);
            } else {
                resultString = resultString + strArr[i] + (i == strArr.length - 1 ? '' : (i == strArr.length - 2 ? symbstr : otag));
            }
        }
    } else {
        return string;
    }
    return resultString;
}

function formatMessage(string) {
    var resultString = "";
    if (config.codeColour1c) {
        resultString = codeColor(string);
    } else {
        resultString = escapeHtml(string);
    }
    resultString = resultString.replace(/\n/gm, '<br>');
    resultString = resultString.replace(/\t/gm, '&emsp;&emsp;');
    if (config.simpleMarkdown) {
        resultString = replacetags(resultString, /\*/gm, "*", '<b>', '</b>');
        resultString = replacetags(resultString, /~/gm, "~", '<i>', '</i>');
        resultString = replacetags(resultString, /_/gm, "_", '<u>', '</u>');
    }
    resultString = replacetags(resultString, /\^\^/gm, "^^", '<blockquote>', '</blockquote>');
    return resultString;
}

function auf(data, socket) {
    let bunDate = bunList.get(data.user + cur_ip);
    if (typeof bunDate != 'undefined' && bunDate >= new Date()) {
        socket.binary(false).send('{"event": "blockUser","user":"' + data.user + '"}');
        return;
    }

    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr('Error postgres connection ', err.stack, "");
        }
        const result = await client.query("SELECT userscat.refid,userscat.pwd,userscat.tmppwd,userscat.description,admusers.roomid as admroom FROM userscat LEFT JOIN (SELECT users_roomscat.roomid, users_roomscat.userid FROM users_roomscat LEFT JOIN roomscat ON roomscat.refid = users_roomscat.roomid WHERE roomscat.roomtype=7) as admusers ON userscat.refid = admusers.userid WHERE userscat.code = $1", [data.user]);
        var hash = crypto.createHash('sha256');
        var sucess = false;
        if (result.rows.length > 0) {
            hash.update(result.rows[0].pwd + socket.id);
            if (hash.digest('hex') == data.password)
                sucess = true;
        }
        if (sucess) {
            var userid = result.rows[0].refid;
            let user = { "userid": userid, "description": result.rows[0].description, "pushadmin": (!result.rows[0].admroom ? false : true), "roomadmin": [], "rooms": [], "baseid": data.baseid, "basename": data.basename, "info": data.compname + " :   " + data.basename + " (" + data.basever + ")", "stid": ""};
            auf_users.set(socket.id, user);

            socket.binary(false).send('{"event":"connected","id":"' + socket.id + '","userid":"' + userid + '","baseid":"' + data.baseid + '","filetranfer":"' + config.filetranfer + '","filemaxsize":' + config.filemaxsize + ',"cipher":"' + (config.https ? socket.request.connection.getCipher().name : '') + '","protocol":"' + (config.https ? socket.request.connection.getProtocol() : '') + '","filepartsize":' + config.filepartsize + ',"setpass":"' + (result.rows[0].tmppwd != '') + '"}');
            
            var eventUserAdd = '{"event":"userAdd","id":"' + socket.id.substring(0, 6) + '","userid":"' + userid + '","user":"' + result.rows[0].description + '","baseid":"' + data.baseid + '","basename":"' + data.basename + '","basever":"' + data.basever + '","baseref":"' + data.baseref + '"}';
            socket.broadcast.binary(false).send(eventUserAdd);
            sendAnotherProcess(JSON.parse(eventUserAdd));

            const usrooms = await client.query("SELECT roomid as roomid, admin as roomadmin, CASE WHEN roomscat.roomtype = 7 THEN FALSE ELSE TRUE END  as pushadmin  FROM users_roomscat INNER JOIN roomscat ON (users_roomscat.roomid = roomscat.refid AND roomscat.marked = false) WHERE users_roomscat.userid = $1::uuid;", [userid]);
            for (let it = 0; it < usrooms.rowCount; it++) {
                if (user.baseid != '26486651-4a0b-5598-6829-155094baddc8') {
                    io.sockets.connected[socket.id].join(usrooms.rows[it].roomid);
                    user.rooms.push(usrooms.rows[it].roomid);
                }

                if (usrooms.rows[it].roomadmin) {
                    user.roomadmin.push(usrooms.rows[it].roomid);
                }
                if (usrooms.rows[it].pushadmin) {
                    user.pushadmin = true;

                }
            }
            log(1, "Подключение сеанса " + socket.id + " пользователь: " + result.rows[0].description + " ip: " + cur_ip, result.rows[0].refid, cur_ip);
            var querytext = "WITH updated AS (INSERT INTO connections (userid, conid, dateon, baseid, ipadress, https, usrdevid, procid, serverid, useragent) VALUES ($1,$2, current_timestamp, $3, $4, $5, $6, $7, $8, $9) RETURNING *) \
                            SELECT userscat.description as user, conns.userid as userid, conid, dateon, dateoff, basescat.description || ' (' || basescat.baseversion || ')' as base, ipadress, devicecat.description as usrdev, contime, auftime, datasintime, pg_size_pretty(datasize) as datasize, https, procid, srvdevicecat.description as server, pg_size_pretty(bytesread) as bytesread, pg_size_pretty(byteswrite) as byteswrite, useragent \
                            FROM updated AS conns \
                            LEFT JOIN devicecat ON (conns.usrdevid = devicecat.refid) LEFT JOIN devicecat AS srvdevicecat ON (conns.serverid = srvdevicecat.refid) \
                            LEFT JOIN basescat ON (conns.baseid = basescat.refid) LEFT JOIN userscat ON (conns.userid = userscat.refid)";
            let res = await client.query(querytext, [userid, socket.id, data.baseid, cur_ip, config.https, data.clientid, process.env.NODE_APP_INSTANCE, serverId, socket.handshake.headers["user-agent"]]);
            if (res.rowCount) {
                res.rows[0].user = encodeURIComponent(res.rows[0].user);
                res.rows[0].base = encodeURIComponent(res.rows[0].base);
                updateAdminClient('{"event":"addConnection","data":' + JSON.stringify(res.rows[0]) + '}');
                sendAnotherProcess({"event": "addConnection","data": res.rows[0]});
            }
            release();

            savebase(data.baseid, data.baseref, data.basename, data.basever, userid);
            saveuserdev(data.clientid, data.ostype, data.osversion, data.appversion, data.proc, data.ram, data.compname, data.infappview, userid);
            
        } else {
            socket.binary(false).send('{"event":"AccessDenied","id":"' + socket.id + '","userid":"","baseid":"' + data.baseid + '"}');
            var usid = null;
            if (result.rows.length > 0)
                usid = result.rows[0].refid;

            log(6, "Безуспешная попытка авторизации пользователя: " + (result.rowCount ? result.rows[0].description : data.user) + " ip: " + cur_ip, usid, cur_ip, data.user);
            if (config.blockusers) {
                const resrow = await client.query("SELECT count(1) as failcount FROM logs WHERE logtype = 6 AND (userid = $1::uuid OR usercode = $3) AND ipadress = $2 AND tmstamp >= current_timestamp - interval '" + config.failauftime + " second';", [usid, cur_ip, data.user]);

                if (resrow.rows.length && resrow.rows[0].failcount >= config.failaufcount) {
                    let blockDate = new Date();
                    blockDate.setTime(blockDate.getTime() + config.blocktime*1000);
                    bunList.set(data.user + cur_ip, blockDate);
                    sendAnotherProcess({"event": "blockUser","blockString": data.user + cur_ip, "blockDate": blockDate});
                    log(6, "Заблокирован пользователь: " + decodeURIComponent(data.user) + " ip: " + cur_ip, usid, cur_ip);
                }
            }
            release();
        }
    });
}

function sendMessage(data, socket){
    ServerDate = new Date();
    data.date = ServerDate.toISOString();
    data.id = data.id.substring(0, 6);
    var message = decodeURIComponent(data.message);
    if (/^\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))$/i.test(message)) {
        data.message = message.replace(/^\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))$/i, '<a href="$&">$&</a>');
        data.datatype = 2;
    } else
        if (data.datatype == 0 || data.datatype == 6)
            data.message = encodeURIComponent(formatMessage(message));

    var msg = JSON.stringify(data);
    if (data.roomid == "") {
        auf_users.forEach((user, key) => {
            if ((user.userid == data.userid || user.userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', msg);
        });
    } else {
        if (data.datatype == 6)
            socket.broadcast.to(data.roomid).binary(false).emit('message', msg);
        else {
            socket.to(data.roomid).binary(false).emit('message', msg);
            socket.binary(false).send(msg);
        }

    }

    pgquery("INSERT INTO messages (tmstamp, userid, destid, mesid, roomid, message, datatype, extdata, devtype, datasize, conid) \
                VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, 0, $10);",
        [ServerDate, data.userid, (data.destid == "" ? null : data.destid), data.mesid, (data.roomid == "" ? null : data.roomid), decodeURIComponent(data.message), data.datatype, decodeURIComponent(data.extdata), data.devtype, cur_socketid]);

    sendAnotherProcess(data);
}

function forwardmessage(data, socket){
    ServerDate = new Date();
    data.date = ServerDate.toISOString();
    data.id = data.id.substring(0, 6);
    var querytext = "INSERT INTO messages (tmstamp, userid, destid, mesid, roomid, message, datatype, extdata, devtype, datasize, conid, parentid)\
    SELECT $1, $2::uuid, $3, $4::uuid, $5, message, datatype, extdata, $6, datasize, $7, $8::uuid FROM messages WHERE mesid = $8 RETURNING *";
    var queryparams = [ServerDate, data.userid, (data.destid == '' ? null : data.destid), new_uuid(), (data.roomid == '' ? null : data.roomid), data.devtype, cur_socketid, data.mesid];

    pgquery(querytext, queryparams).then(result => {
        if (result.length) {
            data.event = "sendMessage";
            data.message = encodeURIComponent(result[0].message);
            data.extdata = encodeURIComponent(result[0].extdata);
            data.parentid = result[0].parentid;
            data.datatype = result[0].datatype;
            data.datasize = result[0].datasize;
            data.mesid = result[0].mesid;
            var msg = JSON.stringify(data);
            if (data.roomid == "")
                auf_users.forEach((user, key) => {
                    if ((user.userid == data.userid || user.userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                        io.sockets.connected[key].binary(false).emit('message', msg);
                });
            else {
                socket.to(data.roomid).binary(false).emit('message', msg);
            }
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing forwardmessage query', err.stack, querytext + "   " + JSON.stringify(queryparams)); });
}

function atachData(data, socket, msg) {
    ServerDate = new Date();
    if (data.PartsCount > 1) {
        if (data.datasize > config.filemaxsize) {
            socket.binary(false).send({ 'event': 'fileSendError', 'error': 'error exceeded maximum file size ' + config.filemaxsize + ' byte' });
            return caughtErr('Error exceeded maximum file size ', "", "");
        }
        var FilePart = data.FilePart + 1;
        data.date = ServerDate.toISOString();
        data.upload = false;
        data.realdatasize = data.realdatasize + Buffer.byteLength(JSON.stringify(msg), 'utf8');
        io.sockets.connected[socket.id].binary(false).emit('message', '{"event": "atachDataPart", "FilePart": ' + FilePart + ',"PartsCount": ' + data.PartsCount + ',"realdatasize": ' + data.realdatasize + ',"upload": ' + true + '}');
        fs.writeFile(config.atachCatalog + data.mesid + data.FilePart + '.json', JSON.stringify(data), function (err) {
            if (err) {
                return caughtErr('Error write file ', err, "");
            }
        });
        if (data.FilePart < data.PartsCount)
            return;
    } else {
        data.realdatasize = Buffer.byteLength(JSON.stringify(msg), 'utf8');
        data.date = ServerDate.toISOString();
        data.upload = false;
    }
    let user = auf_users.get(socket.id);
    data.info = user.info;
    data.event = "atachDataConfirm";
    io.sockets.connected[socket.id].binary(false).emit('message', JSON.stringify(data));
    data.event = "atachData";
    if (data.PartsCount == 1)
        fs.writeFileSync(config.atachCatalog + data.mesid + '.json', JSON.stringify(data));
    data.binary = '';

    pgquery("INSERT INTO messages (tmstamp, userid, destid, mesid, roomid, message, datatype, extdata, devtype, datasize, conid) \
                VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, $9, $10, $11);",
        [ServerDate, data.userid, (data.destid == "" ? null : data.destid), data.mesid, (data.roomid == "" ? null : data.roomid),
            decodeURIComponent(data.message), data.datatype, decodeURIComponent(data.extdata), data.devtype, data.datasize, cur_socketid]);

    data.id = data.id.substring(0, 6);
    msg = JSON.stringify(data);
    if (data.roomid == "")
        auf_users.forEach((user, key) => {
            if ((user.userid == data.userid || user.userid == data.destid) && socket.id != key && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', msg);
        });
    else {
        socket.to(data.roomid).binary(false).emit('message', msg);
    }

    sendAnotherProcess(data);
}

function updateAdminClient(updateMes) {
    auf_users.forEach((user, key) => {
        if (user.pushadmin && user.baseid === "26486651-4a0b-5598-6829-155094baddc8" && typeof io.sockets.connected[key] != 'undefined')
            io.sockets.connected[key].binary(false).emit('message', updateMes);
    });
}

function dataConfirm(data, socket) {
    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr('Error postgres connection ', err.stack, "");
        }
        try {
            var querytext = "WITH updated AS (UPDATE connections SET contime=$3, auftime=$4, datasintime=$5, datasize=$6 WHERE dateoff IS NULL AND conid = $1 AND userid = $2 RETURNING *) \
                            SELECT userscat.description as user, conns.userid as userid, conid, dateon, dateoff, basescat.description || ' (' || basescat.baseversion || ')' as base, ipadress, devicecat.description as usrdev, contime, auftime, datasintime, pg_size_pretty(datasize) as datasize, https, procid, srvdevicecat.description as server, pg_size_pretty(bytesread) as bytesread, pg_size_pretty(byteswrite) as byteswrite, useragent \
                            FROM updated AS conns \
                            LEFT JOIN devicecat ON (conns.usrdevid = devicecat.refid) LEFT JOIN devicecat AS srvdevicecat ON (conns.serverid = srvdevicecat.refid) \
                            LEFT JOIN basescat ON (conns.baseid = basescat.refid) LEFT JOIN userscat ON (conns.userid = userscat.refid)";
            var contime = data.contime > 99999 ? 99999 : data.contime;
            var paramaray = [socket.id, data.userid, contime, data.auftime, data.datasintime, data.datasize];
            let res = await client.query(querytext, paramaray);
            if (res.rowCount) {
                res.rows[0].user = encodeURIComponent(res.rows[0].user);
                res.rows[0].base = encodeURIComponent(res.rows[0].base);
                updateAdminClient('{"event":"updateConnection","data":' + JSON.stringify(res.rows[0]) + '}');
                sendAnotherProcess({"event": "updateConnection","data": res.rows[0]});
            }
            if (!data.datasize)
                return release();

            querytext = "SELECT starttime, filesize FROM datasend WHERE conid = $1 AND dataid = $2;";
            paramaray = [socket.id, data.dataid];
            const result1 = await client.query(querytext, paramaray);
            if (result1.rows.length && data.datasize) {
                var curDateInt = 62135596800000 + Date.now();
                var timems = curDateInt - result1.rows[0].starttime;
                if (timems <= 0)
                    timems = 1;
                var speedmb = result1.rows[0].filesize / timems * 1000 / 1024 / 1024;
                if (speedmb == Infinity)
                    speedmb = 0;

                querytext = "UPDATE  datasend SET endtime = $3, timems = $4, speedmb = $5 WHERE dataid = $1::uuid and conid = $2 and tmstamp = $6;";
                paramaray = [data.dataid, socket.id, curDateInt, timems, speedmb, data.datesync];
                await client.query(querytext, paramaray);
                release();
            } else
                release();

        } catch (err) {
            release();
            return caughtErr('Error executing query ', err.stack, querytext + JSON.stringify(paramaray));
        }
    });
}

function setPas(data, socket) {
    pool.connect(async (err, client, release) => {
        if (err) {
            return caughtErr('Error postgres connection ', err.stack, "");
        }
        try {
            const result = await client.query("SELECT refid as refid,pwd,tmppwd FROM public.userscat WHERE refid = $1::uuid", [data.userid]);

            var hash = crypto.createHash('sha256');
            if (!result.rows.length) {
                release();
                return caughtErr('Неудачное изменение пароля', 'не найден пользователь', '');
            } else {
                hash.update(result.rows[0].pwd + data.id);
                if (hash.digest('hex') != decodeURIComponent(data.pas)) {
                    release();
                    return caughtErr('Неудачное изменение пароля', 'неверный пароль', '');
                }
                if (socket.handshake.headers["user-agent"].startsWith('WebSocket++')) {
                    fs.writeFileSync(config.atachCatalog + data.id + '.zip', Buffer.from(data.npas, 'hex'));
                    const cp = require('child_process');
                    var uzip = cp.spawn("7z", ["e", "-p" + result.rows[0].pwd.replace(/([ ])/g, "") + data.id, "-o" + config.atachCatalog.replace(/\\/g, "/"), "-mem=AES256", (config.atachCatalog + data.id + ".zip").replace("\\", "/")], (process.platform.substr(0, 7) == "Windows" ? { "cwd": "C:/Program Files/7-Zip/" } : {}));
                    uzip.on('close',async () => {
                        var npas = fs.readFileSync("" + config.atachCatalog + data.fname, 'utf8');
                        if (npas.length == 96 && npas.charCodeAt(0) == 65279)
                            npas = npas.substr(1);
                        await pgquery("UPDATE userscat SET pwd = $1, tmppwd = $2 WHERE refid = $3::uuid", [npas, "", data.userid]);
                        release();
                        io.sockets.connected[socket.id].binary(false).emit('message', '{"event":"SetPasConfirm","id":"' + socket.id + '"}');
                        if (fs.existsSync("" + config.atachCatalog + data.fname))
                            fs.unlink("" + config.atachCatalog + data.fname);

                        if (fs.existsSync("" + config.atachCatalog + data.id + '.zip'))
                            fs.unlink("" + config.atachCatalog + data.id + '.zip');
                    });
                    uzip.on('error', function (err) {
                        caughtErr('Ошибка изменения пароля', err, '');
                    });
                } else {
                    var decipher = crypto.createDecipher('aes256', result.rows[0].pwd.replace(/([ ])/g, "") + data.id);
                    var npas = decipher.update(data.npas,'hex','utf8');
                    npas += decipher.final('utf8');
                    await pgquery("UPDATE userscat SET pwd = $1, tmppwd = $2 WHERE refid = $3::uuid", [npas, "", data.userid]);
                    release();
                    io.sockets.connected[socket.id].binary(false).emit('message', '{"event":"SetPasConfirm","id":"' + socket.id + '"}');
                }
            }
        } catch (err) {
            release();
            return caughtErr('Error executing query ', err.stack, "SELECT refid as refid,pwd,tmppwd FROM public.userscat WHERE refid = $1::uuid " + JSON.stringify([data.userid]));
        }
    });
}

function GetAtach(data, socket) {
    try {
        var contents = "";
        if (fs.existsSync("" + config.atachCatalog + data.mesid + ".json")) {
            contents = fs.readFileSync("" + config.atachCatalog + data.mesid + ".json", 'utf8');
        } else if (data.FilePart > 0) {
            contents = fs.readFileSync("" + config.atachCatalog + data.mesid + data.FilePart + ".json", 'utf8');
        } else if (typeof data.FilePart == 'undefined') {
            contents = fs.readFileSync("" + config.atachCatalog + data.mesid + "1.json", 'utf8');
            data.FilePart = 1;
        }
    } catch (err) {
        return caughtErr('Error GetAtach req ', err.stack, "");
    }

    if (contents != '') {
        var filecontent = JSON.parse(contents);

        if (data.FilePart < filecontent.PartsCount) {
            socket.compress(false).binary(false).emit('atachDataPart', filecontent.mesid + filecontent.FilePart + ":" + filecontent.PartsCount + ";" + filecontent.binary);
        } else {
            socket.compress(false).binary(false).emit('atachDataPart', filecontent.mesid + filecontent.FilePart + ":" + filecontent.PartsCount + ";" + filecontent.binary);
            filecontent.binary = "";
            filecontent.event = "dowmloadAtach";
            socket.binary(false).emit('message', JSON.stringify(filecontent));
        }
    }
}

function sha256(p) {
    const hash = crypto.createHash('sha256');
    hash.update(p);
    return '' + hash.digest('hex');
}

function changeUser(data, admin) {
    var updusrquery = "UPDATE userscat SET usersign = $1, icon = $2, userid = $3::uuid, changestamp = current_timestamp \
                WHERE refid = $3::uuid AND (usersign != $1 OR icon != $2) RETURNING changestamp;";
    var updusrparams = [decodeURIComponent(data.sign), data.icon, data.userid];
    if (admin) {
        updusrquery.replace('refid = $3', 'refid = $4');
        updusrparams.push(data.refid);
    }
    if (admin && data.tmppwd !== '') {
        updusrquery.replace('userid = $3::uuid,', 'userid = $3::uuid, tmppwd = $5, pwd = $6,');
        updusrparams.push(data.tmppwd);
        updusrparams.push(sha256(sha256(data.tmppwd)));
    }

    pgquery(updusrquery, updusrparams).then(result => {
        if (result.length) {
            data.event = 'confirmChangeUser';
            data.tmppwd = "";
            data.id = data.id.substring(0,6);
            data.changestamp = result[0].changestamp;
            io.sockets.binary(false).emit('message', JSON.stringify(data));
            // socket.binary(false).emit('message', JSON.stringify(data));
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing changeUser query', err.stack, updusrquery + "   " + JSON.stringify(updusrparams)); });
}

function newUser(data) {
    var updusrquery = "INSERT INTO userscat SET refid = $1, number = $2, code = $3, description = $4, usersign = $5, icon = $6, userid = $7::uuid, pwd = $8, tmppwd = $9 changestamp = current_timestamp, marked = false RETURNING changestamp;";
    var updusrparams = [data.refid, data.number, data.code, decodeURIComponent(data.description), decodeURIComponent(data.sign), data.icon, data.userid, sha256(sha256(data.tmppwd)), data.tmppwd];

    pgquery(updusrquery, updusrparams).then(result => {
        if (result.length) {
            data.event = 'confirmNewUser';
            data.tmppwd = "";
            data.id = data.id.substring(0,6);
            data.changestamp = result[0].changestamp;
            io.sockets.binary(false).emit('message', JSON.stringify(data));
            // socket.binary(false).emit('message', JSON.stringify(data));
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing newUser query', err.stack, updusrquery + "   " + JSON.stringify(updusrparams)); });
}

function editRoom(data, socket, msg) {
    let user = auf_users.get(socket.id);
    if (data.event != 'newRoom' && user.roomadmin.indexOf(data.roomid) == -1) {
        return caughtErr('Error unautorized change room ', '', msg);
    }
    var updroomquery = "UPDATE roomscat SET description = $1, extdesc = $2, icon = $3, users = $4, userid = $5::uuid, changestamp = current_timestamp \
        WHERE refid = $6::uuid AND (description != $1 OR extdesc != $2 OR icon != $3 OR users != $4) RETURNING changestamp;";

    if (data.event == 'newRoom')
        updroomquery = "INSERT INTO roomscat (description, extdesc, icon, users, userid, refid, code, changestamp) VALUES ( $1, $2, $3, $4,$5::uuid, $6::uuid, $6, current_timestamp) RETURNING changestamp;";
    var updroomparams = [decodeURIComponent(data.name), decodeURIComponent(data.description), data.icon, JSON.stringify(data.users), data.userid, data.roomid];
    pgquery(updroomquery, updroomparams).then(result => {
        if (result.length) {
            data.event = 'confirmChangeRoom';
            data.id = data.id.substring(0,6);
            data.marked = false;
            data.changestamp = result[0].changestamp;
            checkRoomUsers(data);
            data.event = 'confirmChangeRoom';
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing changeRoom query', err.stack, updroomquery + "   " + JSON.stringify(updroomparams)); });
}

function changeContact(data, socket) {
    var updquerytext = "UPDATE users_contacts SET description = $3, changestamp = current_timestamp, blocknotifications = $4, blockmessages = $5 \
                WHERE userid = $1::uuid AND contactid = $2::uuid AND (description != $3 OR blocknotifications != $4 OR blockmessages != $5) RETURNING changestamp;";
    var updqueryparams = [data.userid, data.contactid, decodeURIComponent(data.description), data.blocknotifications, data.blockmessages];
    pgquery(updquerytext, updqueryparams).then(result => {
        if (result.length) {
            data.event = 'confirmChangeContact';
            data.changestamp = result[0].changestamp;
            // socket.binary(false).emit('message', JSON.stringify(data));
            auf_users.forEach((user, key) => {
                if (user.userid == data.userid && typeof io.sockets.connected[key] != 'undefined')
                    io.sockets.connected[key].binary(false).emit('message', JSON.stringify(data));
            });
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing changeContact query', err.stack, updquerytext + "   " + JSON.stringify(updqueryparams)); });
}

function roomExit(data, socket) {
    var roomexquery = "SELECT users FROM roomscat WHERE refid = $1::uuid AND $2::uuid IN (SELECT userid FROM users_roomscat WHERE refid = $1::uuid AND userid = $2::uuid);";
    pgquery(roomexquery, [data.roomid, data.userid]).then(result => {
        if (!result.length) {
            return caughtErr('Ошибка  roomExit query', "Не найдена комната", roomexquery + "   " + data.roomid);
        }
        for (let i = 0; i < result.users.length; i++) {
            if (result.users[i].userid == data.userid) {
                result.users.splice(i, 1);
                pgquery("UPDATE roomscat SET users = $2 WHERE refid = $1::uuid RETURNING *", [data.roomid, JSON.stringify(result.users)]);
                data.event = 'confirmRoomExit';
                data.id = data.id.substring(0,6);
                io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
                socket.leave(data.roomid);
                sendAnotherProcess(data);
            }
        }
    }).catch(err => { caughtErr('Error executing roomExit query', err.stack, roomexquery + "   " + data.roomid); });
}

function roomMarked(data, admin) {
    var roommarkquery = "UPDATE roomscat SET marked = $3, userid = $2::uuid  WHERE refid = $1::uuid " + (admin ? "" : "AND $2::uuid IN (SELECT userid FROM users_roomscat WHERE refid = $1::uuid AND userid = $2::uuid AND admin)") + " RETURNING changestamp;";
    pgquery(roommarkquery, [data.roomid, data.userid, data.mark]).then(result => {
        if (result.length) {
            data.event = 'confirmRoomMarked';
            data.id = data.id.substring(0,6);
            data.tmstamp = result[0].changestamp;
            io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing roomMarked query', err.stack, roommarkquery + "   " + data.roomid); });
}

function userMarked(data) {
    var usermarkquery = "UPDATE userscat SET marked = $3, userid = $2::uuid WHERE refid = $1::uuid RETURNING changestamp;";
    pgquery(usermarkquery, [data.refid,data.userid,data.mark]).then(result => {
        if (result.length) {
            data.event = 'confirmUserMarked';
            data.id = data.id.substring(0,6);
            data.tmstamp = result[0].changestamp;
            io.sockets.emit('message', JSON.stringify(data));
            sendAnotherProcess(data);
        }
    }).catch(err => { caughtErr('Error executing userMarked query', err.stack, usermarkquery + "   " + data.userid); });
}

io.sockets.on('connection', (socket) => {

    socket.on('message', (msg) => {
        cur_socketid = socket.id;
        var ip = socket.request.connection.remoteAddress.toString().replace("::ffff:", "");
        cur_ip = ip;
        if (typeof msg == 'string') {
            try {
                data = JSON.parse(msg);
            } catch (err) {
                return caughtErr('Error on message parse ', err.stack, msg);
            }
        } else if (typeof msg == 'object') {
            data = msg;
        }
        if (typeof data["event"] == 'undefined')
            return caughtErr('Error message ', JSON.stringify(data));

        if (data.event == 'auf') {
            auf(data, socket);
            return;
        }
        if (!auf_users.has(socket.id)) {
            return caughtErr('Error unautorized access ', '', msg);
        }
        data['id'] = socket.id;
        let user = auf_users.get(socket.id);
        var UserId = user.userid;
        if (typeof data['userid'] != 'undefined' && UserId != data['userid']) {
            log(6, "Попытка представиться другим пользователем!!! пользователь: " + UserId + " представлялся: " + data['userid'] + "  сообщение: " + msg, UserId, "");
            data['userid'] = UserId;
        }

        if (data.event == 'getProcessStatistic') {
            if (typeof data.updatetime === 'undefined')
                data.updatetime = 1000;
            if (user.stid !== ''){
                clearInterval(user.stid);
                user.stid = '';
            }
            if (data.updatetime > 0 && user.pushadmin)
                user.stid = setInterval(getProcessStatistic, data.updatetime, socket.id);
            else if (data.updatetime <= 0 && user.pushadmin)
                getProcessStatistic(socket.id);
        } else if (data.event == 'atachData') {
            atachData(data, socket, msg);
        } else if (data.event == 'getData' || data.event == 'getDataSin') {
            datasinc(data);
            return;
        } else if (data.event == 'dataConfirm') {
            dataConfirm(data, socket);
        } else if (data.event == 'setPas') {
            setPas(data, socket);
        } else if (data.event == 'mesConfirm') {
            if (data.datatype == 6) {
                pgquery("INSERT INTO notifications (tmstamp, mesid, userid, baseid, usrdevid, logtype) VALUES ($5, $1::uuid, $2::uuid, $3::uuid, $4::uuid, 3);", [data.mesid, data.userid, data.baseid, data.clientid, new Date()]);
            } else {
                pgquery("INSERT INTO notifications (tmstamp, mesid, userid, baseid, usrdevid, logtype) VALUES (current_timestamp, $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5);", [data.mesid, data.userid, data.baseid, data.clientid, (data.type == "read" ? 1 : 0)]);
            }
        } else if (data.event == 'messConfirm') {
            var qtext = "INSERT INTO notifications (tmstamp, mesid, userid, baseid, usrdevid, logtype) VALUES ";
            for (let i = 0; i < data.messidarr.length; i++) {
                if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.messidarr[i]))
                    qtext = qtext + ((qtext.length == 85) ? "(" : ", (") + "current_timestamp, '" + data.messidarr[i] + "'::uuid, $1::uuid, $2::uuid, $3::uuid, $4) ";
            }
            pgquery(qtext, [data.userid, data.baseid, data.clientid, (data.type == "read" ? 1 : 0)]);

        } else if (data.event == 'atachDataConfirm') {
            return pgquery("INSERT INTO datasend (dataid, filename, filesize, conid, starttime, endtime, tmstamp, timems, speedmb, https, nodejsver, socketiover, serverid, datatype, upload, diskfilesize, conntype, devtype) \
                VALUES ($1, $2, $3, $4, $5, $6, current_timestamp, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17);",
                [data.dataid, "", data.datasize, data.id, data.sendtime, data.gettime, data.gettime - data.sendtime, data.realdatasize / (data.gettime - data.sendtime) * 1000 / 1024 / 1024,
                config.https, process.versions.node, require("socket.io/package").version, serverId, data.datatype, data.upload, data.realdatasize, data.conntype, data.devtype]);
        } else if (data.event == 'GetAtach') {
            GetAtach(data, socket);
            return;
        } else if (data.event == 'changeUser') {
            changeUser(data, user.pushadmin);
        } else if (data.event == 'newUser') {
            if (user.pushadmin)
                newUser(data, user.pushadmin);    
        } else if (data.event == 'changeRoom' || data.event == 'newRoom') {
            editRoom(data, socket, msg);
        } else if (data.event == 'changeContact') {
            changeContact(data, socket);
        } else if (data.event == 'roomExit') {
            roomExit(data, socket);
        } else if (data.event == 'roomMarked') {
            roomMarked(data, user.pushadmin);
        } else if (data.event == 'userMarked') {
            if (user.pushadmin)
                userMarked(data);    
        } else if (data.event == 'sendMessage') {
            data.info = user.info;
            sendMessage(data, socket);
        } else if (data.event == 'forwardmessage') {
            data.info = user.info;
            forwardmessage(data, socket);
        } else if (data.event == 'getBaseData') {
            if (user.pushadmin)
                dataDB(data);
        } else if (data.event == 'getUpdatedBaseData') {
            if (user.pushadmin)
                dataDBupdated(data);        
        } else if (data.event == 'getStatistic') {
            if (user.pushadmin)
                statistic(data);
        } else if (data.event == 'getTestResult') {
            if (user.pushadmin)
                testresult(data);
        } else if (data.event == 'saveTestResult') {
            if (user.pushadmin)
                testresultsave(data);        
        }
    });

    socket.on('disconnect', function () {
        if (!auf_users.has(socket.id))
            return;

        var ip = socket.request.connection.remoteAddress.toString().replace("::ffff:", "");
        cur_ip = ip;

        let user = auf_users.get(socket.id);
        var useridoff = user.userid;
        pgquery("UPDATE connections SET dateoff = current_timestamp, bytesread = $3, byteswrite = $4 WHERE dateoff IS NULL AND conid = $1 AND userid = $2::uuid RETURNING pg_size_pretty(bytesread) as bytesread, pg_size_pretty(byteswrite) as byteswrite", [socket.id, useridoff, socket.request.client.bytesRead, socket.request.client.bytesWritten]).then(resultarr => {
            if (resultarr.length) {
                updateAdminClient('{"event":"updateDisconnect","conid":"' + socket.id + '", "userid": "' + useridoff + '", "bytesread": "' + resultarr[0].bytesread + '", "byteswrite": "' + resultarr[0].byteswrite + '"}');
                sendAnotherProcess({"event": "updateDisconnect","conid": socket.id, "userid": useridoff, "bytesread": resultarr[0].bytesread, "byteswrite": resultarr[0].byteswrite});
            }
        }).catch(err => { caughtErr("uncaughtException ", err, ''); });
        log(1, "Отключение сеанса " + socket.id + " пользователь: " + user.description + " ip: " + ip, useridoff, ip);
        var data = '{"event": "userSplit", "userid": "' + user.userid + '", "id": "' + socket.id.substring(0, 6) + '"}';
        socket.broadcast.json.binary(false).send(data);
        sendAnotherProcess(JSON.parse(data));

        auf_users.delete(socket.id);
        socket.disconnect();
    });

    setTimeout(function (socid) {
        if (!auf_users.has(socket.id) && typeof io.sockets.connected[socid] != 'undefined')
            io.sockets.connected[socid].disconnect();
    }, 30000, socket.id);
});

process.on('message', function (packet) {
    var data = packet.data.message;
    if ((data.event == "sendMessage" && data.roomid == "") || (data.event == "atachData" && data.roomid == "")) {
        auf_users.forEach((user, key) => {
            if ((user.userid == data.userid || user.userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', JSON.stringify(data));
        });
    } else if (data.event == "confirmChangeRoom") {
        checkRoomUsers(data);
    } else if (data.event == "confirmChangeContact") {
        auf_users.forEach((user, key) => {
            if (user.userid == data.userid && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', JSON.stringify(data));
        });
    } else if (data.event == "updateConnection" || data.event == "updateDisconnect" || data.event == "addConnection" || data.event == "addLogRow") {
        updateAdminClient(JSON.stringify(data)); 
    } else if (data.event == "blockUser") {    
        bunList.set(data.blockString, data.blockDate);
    } else if (data.event == "userAdd" || data.event == "userSplit" || data.event == "confirmChangeUser" || data.event == "confirmUserMarked") {
        io.sockets.emit('message', JSON.stringify(data));
    } else if ((data.event == "sendMessage" && data.roomid != "") || (data.event == "atachData" && data.roomid != "") || data.event == "confirmRoomMarked" || data.event == "confirmRoomExit") {
        if (typeof io.sockets.adapter.rooms != 'undefined' && typeof io.sockets.adapter.rooms[data.roomid] != 'undefined')
            io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
    }
});

probe.metric({
    name: 'connections',
    value: function () {
        return auf_users.size;
    }
});

probe.metric({
    name: 'deburl',
    value: function () {
        return inspector.url();
    }
});

