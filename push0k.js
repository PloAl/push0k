var config = require('./config');

var auf_clients = [];
var bunList = [];
var usersList = {};
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var pmx = require('pmx').init({ network: true, ports: true });
var probe = pmx.probe();
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
const pool = new Pool(config.pgconf);
const socketioVersion = require("socket.io/package").version;
const inspector = require('inspector');

pm2.connect(function (err) {
    if (err) {
        console.error(err);
        process.exit(2);
    }
});

if (!config.https) {
    var httpServer = require('http').createServer().listen(config.port, { wsEngine: config.wsEngine });
    io = require('socket.io')(httpServer, { pingInterval: config.pingInterval, pingTimeout: config.pingTimeout, wsEngine: config.wsEngine });
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
        console.error(description, err, errobj);
    }
    var UserId = null;
    var BaseId = null;
    var Info = "";
    if (typeof usersList[cur_socketid] != 'undefined') {
        UserId = usersList[cur_socketid].userid;
        BaseId = usersList[cur_socketid].baseid;
        Info = usersList[cur_socketid].info;
    }
    if (config.writelogerrtable) {

        pool.query("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, conid) VALUES (current_timestamp, $1, $2::uuid, $3, $4, $5::uuid, $6);",
            [3, new_uuid(), "Ошибка!!! " + description + "\r\n Ошибка: " + err + (errobj == "" ? "" : "\r\n" + errobj), cur_ip, UserId, cur_socketid], (err) => {
                if (err) {
                    console.error("Error errsave query ", err, errobj);
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
                    console.error("Error err add message query ", err, errobj);
                }
            });
        sendAnotherProcess(data);
    }
}

function datasinc(data) {

    var usersquery = "SELECT * FROM (SELECT catusers.refid as userid, catusers.marked, catusers.number as code, catusers.description as name, catusers.icon as icon, catusers.usersign as sign,CASE WHEN usercontact.changestamp > catusers.changestamp THEN usercontact.changestamp ELSE catusers.changestamp END as changestamp, usercontact.description as description, usercontact.blocknotifications, usercontact.blockmessages FROM (SELECT userid, contactid, description, blocknotifications, blockmessages, changestamp  FROM users_contacts WHERE userid = $1::uuid) as usercontact LEFT JOIN userscat as catusers ON (usercontact.contactid = catusers.refid)) as users WHERE users.changestamp > $2";
    var roomsquery = "SELECT refid as roomid, marked, code, description as name,icon as icon, extdesc as description, roomtype, changestamp, users as users FROM public.roomscat WHERE refid IN (SELECT roomid as roomid FROM users_roomscat WHERE userid = $1::uuid) and  changestamp > $2;";
    var messquery = "SELECT messages.mesid as mesid,destid as destid, messages.userid as userid, roomid as roomid, tmstamp as date, datatype, datasize, message, extdata, devtype, coalesce(coninfo.info,'') as info, parentid, \
                            CASE WHEN (roomid IS NULL AND messages.userid = $1::uuid) THEN destid WHEN (roomid IS NULL AND destid = $1::uuid) THEN messages.userid ELSE roomid END as orfield, \
                            CASE WHEN messreaded.mesid IS NULL AND $1::uuid NOT IN (destid, messages.userid) THEN FALSE WHEN messreaded.readed = 0 THEN FALSE ELSE TRUE END as readed \
                        FROM messages LEFT JOIN (SELECT mesid, MAX(logtype) as readed FROM notifications WHERE tmstamp > $2 AND userid = $1 AND logtype = 1 GROUP BY mesid) as messreaded ON (messages.mesid = messreaded.mesid)\
                        LEFT JOIN (SELECT connections.conid, devicecat.description || ' :  ' || basescat.description || ' (' || basescat.baseversion || ')' as info FROM connections LEFT JOIN devicecat ON (connections.usrdevid = devicecat.refid) LEFT JOIN basescat ON (connections.baseid = basescat.refid)) as coninfo ON (messages.conid = coninfo.conid)\
                        WHERE (roomid IN (SELECT roomid as roomid FROM users_roomscat WHERE userid = $1::uuid) OR $1::uuid IN (messages.userid,destid)) AND datatype != 6 AND tmstamp > $2 ORDER BY orfield, date";

    var qmessparams = [data.userid, data.lastdatesinc];

    Promise.all([
        pgquery(usersquery, qmessparams),
        pgquery(roomsquery, qmessparams),
        pgquery("SELECT userid as userid,dateon,baseid,substr(conid,1,6) as id FROM public.connections WHERE dateoff IS NULL", []),
        pgquery(messquery, qmessparams)
    ]).then(qresults => {

        var dataid = new_uuid();
        var curDate = new Date();
        var resultdata = '{"Users":' + JSON.stringify(qresults[0]) + ',"Rooms": ' + JSON.stringify(qresults[1]) + ',"joinedRooms": ' + JSON.stringify(usersList[cur_socketid].rooms) + ',"Mess": ' + JSON.stringify(qresults[3]) + ',"Cons": ' + JSON.stringify(qresults[2]) + '}';
        var resultText = '{"event": "datasync", "userscount":' + qresults[0].length + ',"roomscount": ' + qresults[1].length + ',"messcount": ' + qresults[3].length + ',"conscount": ' + qresults[2].length + ',"data": "' + Buffer.from(resultdata).toString("base64") + '","dataid": "' + dataid + '","datesync": "' + curDate.toISOString() + '"}';

        var curDateInt = 62135596800000 + Date.now();
        io.sockets.connected[data.id].binary(false).emit("message", resultText);
        pgquery("INSERT INTO datasend (dataid, conid, starttime, endtime, timems, tmstamp, https, nodejsver, socketiover, datatype, filesize, serverid, filename) VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, 0, $8, $9, '');", [dataid, data.id, curDateInt, curDate, String(config.https ? true : false).toUpperCase(), process.versions.node, socketioVersion, Buffer.byteLength(resultText, 'utf8'), serverId]);
    }).catch(err => { caughtErr("uncaughtException ", err, JSON.stringify(data)); });

}

function log(logtype, description, userid, ipadress) {
    pgquery("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, conid) VALUES (current_timestamp, $1, $2::uuid, $3, $4, $5, $6);", [logtype, new_uuid(), description, ipadress, userid, cur_socketid]);
}

process.on('uncaughtException', function (err) {
    caughtErr("uncaughtException ", err, JSON.stringify(data));
});

process.on('SIGINT', function () {

    pool.end();
    process.exit(0);

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
            querytext = "INSERT INTO devicecat (refid, marked, code, description, platformtype, osversion, appversion, processor, memory,useragentinformation,servercore,servercpufrequency,servercpu,userid) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,'',0,0,'',$10);";

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
    for (let key in usersList) {
        if (typeof io.sockets.connected[key] != 'undefined' && !(data.roomid in io.sockets.connected[key].rooms) && findUser(dataRoom.users, usersList[key].userid)) {
            io.sockets.connected[key].join(data.roomid);
            dataRoom.event = dataRoom.event + 'Join';
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
        } else if (typeof io.sockets.connected[key] != 'undefined' && data.roomid in io.sockets.connected[key].rooms && !(findUser(dataRoom.users, usersList[key].userid))) {
            io.sockets.connected[key].leave(data.roomid);
            dataRoom.event = dataRoom.event + 'Leave';
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
        } else if (typeof io.sockets.connected[key] != 'undefined' && data.roomid in io.sockets.connected[key].rooms)
            io.sockets.connected[key].binary(false).emit('message', JSON.stringify(dataRoom));
    }
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
            setTimeout(getProcessStatistic, 1000, socid);
            io.sockets.connected[socid].binary(false).emit('message', '{"event": "ProcessStatistic","processDescriptionList": ' + getProcessInfo(processDescriptionList) + '}');
        }
    });
}

function getProcessInfo(processList) {
    var procarr = "[";
    for (let i = 0; i < processList.length; i++)
        procarr = procarr + (procarr == "[" ? "" : ",") + '{"name": "' + processList[i].name + '","pid":' + processList[i].pid + ',"pm_id":' + processList[i].pm_id + ',"memory":' + (processList[i].monit.memory / 1024 / 1024) + ',"cpu":' + processList[i].monit.cpu + ',"pm_uptime":' + processList[i].pm2_env.pm_uptime + ',"status":"' + processList[i].pm2_env.status + '","connections":' + (typeof processList[i].pm2_env.axm_monitor.connections == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.connections.value) + ',"net_ul":"' + (typeof processList[i].pm2_env.axm_monitor['Network Upload'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network Upload'].value) + '","net_dl":"' + (typeof processList[i].pm2_env.axm_monitor['Network Download'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network Download'].value) + '","HTTP":"' + (typeof processList[i].pm2_env.axm_monitor.HTTP == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.HTTP.value) + '","open_ports":' + processList[i].pm2_env.axm_monitor['Open ports'].value + ', "deburl":"' + processList[i].pm2_env.axm_monitor.deburl.value + '", "errlogpath":"' + encodeURIComponent(processList[i].pm2_env.pm_err_log_path) + '"}';

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
    if (typeof bunList[data.user + cur_ip] != 'undefined' && bunList[data.user + cur_ip] >= new Date()) {
        socket.binary(false).send('{"event": "blockUser","user":"' + data.user + '"}');
        return;
    }

    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr('Error postgres connection ', err.stack, "");
        }
        //let userid = crypto.createHash('md5').update(data.user).digest('hex');
        const result = await client.query("SELECT refid as refid,pwd,tmppwd,description FROM public.userscat WHERE code = $1", [data.user]);
        var hash = crypto.createHash('sha256');
        var sucess = false;
        if (result.rows.length > 0) {
            hash.update(result.rows[0].pwd + socket.id);
            if (hash.digest('hex') == data.password)
                sucess = true;
        }
        if (sucess) {
            auf_clients.push(socket.id);

            var userid = result.rows[0].refid;

            socket.binary(false).send('{"event":"connected","id":"' + socket.id + '","userid":"' + userid + '","baseid":"' + data.baseid + '","filetranfer":"' + config.filetranfer + '","filemaxsize":' + config.filemaxsize + ',"cipher":"' + socket.request.connection.getCipher().name + '","protocol":"' + socket.request.connection.getProtocol() + '","filepartsize":' + config.filepartsize + ',"setpass":"' + (result.rows[0].tmppwd != '') + '"}');
            log(1, "Подключение сеанса " + socket.id + " пользователь: " + result.rows[0].description + " ip: " + cur_ip, result.rows[0].refid, cur_ip);
            pgquery("INSERT INTO connections (userid, conid, dateon, baseid, ipadress, https, usrdevid, procid, serverid, useragent) VALUES ($1,$2, current_timestamp, $3, $4, $5, $6, $7, $8, $9);", [userid, socket.id, data.baseid, cur_ip, config.https, data.clientid, process.env.NODE_APP_INSTANCE, serverId, socket.handshake.headers["user-agent"]]);
            
            var eventUserAdd = '{"event":"userAdd","id":"' + socket.id.substring(0, 6) + '","userid":"' + userid + '","user":"' + result.rows[0].description + '","baseid":"' + data.baseid + '","basename":"' + data.basename + '","basever":"' + data.basever + '","baseref":"' + data.baseref + '"}';
            socket.broadcast.binary(false).send(eventUserAdd);
            sendAnotherProcess(JSON.parse(eventUserAdd));
            usersList[socket.id] = { "userid": userid, "description": result.rows[0].description, "pushadmin": false, "roomadmin": [], "rooms": [], "baseid": data.baseid, "info": data.compname + " :   " + data.basename + " (" + data.basever + ")" };

            const usrooms = await client.query("SELECT roomid as roomid, admin as roomadmin, CASE WHEN roomscat.roomtype = 7 THEN FALSE ELSE TRUE END  as pushadmin  FROM users_roomscat INNER JOIN roomscat ON (users_roomscat.roomid = roomscat.refid AND roomscat.marked = false) WHERE users_roomscat.userid = $1::uuid;", [userid]);
            for (let it = 0; it < usrooms.rowCount; it++) {
                if (data.basename != 'Push0k%20Admin') {
                    io.sockets.connected[socket.id].join(usrooms.rows[it].roomid);
                    usersList[socket.id].rooms.push(usrooms.rows[it].roomid);
                }

                if (usrooms.rows[it].roomadmin) {
                    usersList[socket.id].roomadmin.push(usrooms.rows[it].roomid);
                }
                if (usrooms.rows[it].pushadmin) {
                    usersList[socket.id].pushadmin = true;

                }
            }
            release();

            savebase(data.baseid, data.baseref, data.basename, data.basever, userid);
            saveuserdev(data.clientid, data.ostype, data.osversion, data.appversion, data.proc, data.ram, data.compname, data.infappview, userid);
            
        } else {
            socket.binary(false).send('{"event":"AccessDenied","id":"' + socket.id + '","userid":"","baseid":"' + data.baseid + '"}');
            var usid = null;
            if (result.rows.length > 0)
                usid = result.rows[0].refid;

            log(6, "Безуспешная попытка авторизации пользователя: " + (result.rowCount ? result.rows[0].description : data.user) + " ip: " + cur_ip, usid, cur_ip);
            if (config.blockusers && usid != "") {
                const resrow = await client.query("SELECT count(1) as failcount FROM logs WHERE logtype = 6 AND userid =$1::uuid AND ipadress = $2 AND tmstamp >= current_timestamp - interval '" + config.failauftime + " second';", [usid, cur_ip]);

                if (resrow.rows.length && resrow.rows[0].failcount >= config.failaufcount) {
                    bunList[data.user + cur_ip] = new Date();
                    bunList[data.user + cur_ip].setSeconds(bunList[data.user + cur_ip].getSeconds() + config.blocktime);
                    log(6, "Заблокирован пользователь: " + decodeURIComponent(data.user) + " ip: " + cur_ip, usid, cur_ip);
                    release();
                }
            } else
                release();
        }
    });
}

function sendMessage(data, socket){
    ServerDate = new Date();
    data.date = ServerDate.toISOString();
    data.id = data.id.substring(0, 6);
    data.info = usersList[socket.id].info;
    var message = decodeURIComponent(data.message);
    if (/^\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))$/i.test(message)) {
        data.message = message.replace(/^\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))$/i, '<a href="$&">$&</a>');
        data.datatype = 2;
    } else
        if (data.datatype == 0 || data.datatype == 6)
            data.message = encodeURIComponent(formatMessage(message));

    var msg = JSON.stringify(data);
    if (data.roomid == "") {
        for (var key in usersList) {
            if ((usersList[key].userid == data.userid || usersList[key].userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', msg);
        }
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
    data.info = usersList[socket.id].info;
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
                for (var key in usersList) {
                    if ((usersList[key].userid == data.userid || usersList[key].userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                        io.sockets.connected[key].binary(false).emit('message', msg);
                }
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
    data.info = usersList[socket.id].info;
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
        for (var key in usersList) {
            if ((usersList[key].userid == data.userid || usersList[key].userid == data.destid) && socket.id != key && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', msg);
        }
    else {
        socket.to(data.roomid).binary(false).emit('message', msg);
    }

    sendAnotherProcess(data);
}

function dataConfirm(data, socket) {
    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            return caughtErr('Error postgres connection ', err.stack, "");
        }
        try {
            var querytext = "UPDATE connections SET contime=$3, auftime=$4, datasintime=$5, datasize=$6 WHERE dateoff IS NULL AND conid = $1 AND userid = $2;";
            var paramaray = [socket.id, data.userid, data.contime, data.auftime, data.datasintime, data.datasize];
            await client.query(querytext, paramaray);
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
            socket.binary(false).emit('atachDataPart', filecontent.mesid + filecontent.FilePart + ":" + filecontent.PartsCount + ";" + filecontent.binary);
        } else {
            socket.binary(false).emit('atachDataPart', filecontent.mesid + filecontent.FilePart + ":" + filecontent.PartsCount + ";" + filecontent.binary);
            filecontent.binary = "";
            filecontent.event = "dowmloadAtach";
            socket.binary(false).emit('message', JSON.stringify(filecontent));
        }
    }
}

function changeUser(data, socket) {
    var updusrquery = "UPDATE userscat SET usersign = $1, icon = $2, userid = $3::uuid, changestamp = current_timestamp \
                WHERE refid = $3::uuid AND (usersign != $1 OR icon != $2) RETURNING changestamp;";
    var updusrparams = [decodeURIComponent(data.sign), data.icon, data.userid];
    pgquery(updusrquery, updusrparams).then(result => {
        if (result.length) {
            data.event = 'confirmChangeUser';
            data.changestamp = result[0].changestamp;
            socket.broadcast.binary(false).emit('message', JSON.stringify(data));
        }
    }).catch(err => { caughtErr('Error executing changeUser query', err.stack, updusrquery + "   " + JSON.stringify(updusrparams)); });
}

function editRoom(data, socket, msg) {
    if (data.event != 'newRoom' && usersList[socket.id].roomadmin.indexOf(data.roomid) == -1) {
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
            socket.binary(false).emit('message', JSON.stringify(data));
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
                io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
                socket.leave(data.roomid);
            }
        }
    }).catch(err => { caughtErr('Error executing roomExit query', err.stack, roomexquery + "   " + data.roomid); });
}

function roomMarked(data) {
    var roommarkquery = "UPDATE roomscat SET marked = true WHERE refid = $1::uuid AND $2::uuid IN (SELECT userid FROM users_roomscat WHERE refid = $1::uuid AND userid = $2::uuid AND admin) RETURNING changestamp;";
    pgquery(roommarkquery, [data.roomid, data.userid]).then(result => {
        if (result.length) {
            data.event = 'confirmRoomMarked';
            io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
        }
    }).catch(err => { caughtErr('Error executing roomMarked query', err.stack, roommarkquery + "   " + data.roomid); });
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
        if (auf_clients.indexOf(socket.id) == -1) {
            return caughtErr('Error unautorized access ', '', msg);
        }
        data['id'] = socket.id;
        if (typeof usersList[socket.id] != 'undefined') {
            var UserId = usersList[socket.id].userid;
            if (typeof data['userid'] != 'undefined' && UserId != data['userid']) {
                log(6, "Попытка представиться другим пользователем!!! пользователь: " + UserId + " представлялся: " + data['userid'] + "  сообщение: " + msg, UserId, "");
                data['userid'] = UserId;
            }
        }
        if (data.event == 'getProcessStatistic') {
            if (usersList[socket.id].pushadmin)
                setTimeout(getProcessStatistic, 1000, socket.id);
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
            changeUser(data, socket);
        } else if (data.event == 'changeRoom' || data.event == 'newRoom') {
            editRoom(data, socket, msg);
        } else if (data.event == 'changeContact') {
            changeContact(data, socket);
        } else if (data.event == 'roomExit') {
            roomExit(data, socket);
        } else if (data.event == 'roomMarked') {
            roomMarked(data);
        } else if (data.event == 'sendMessage') {
            sendMessage(data, socket);
        } else if (data.event == 'forwardmessage') {
            forwardmessage(data, socket);
        }

    });

    socket.on('disconnect', function () {
        if (auf_clients.indexOf(socket.id) == -1)
            return;

        var ip = socket.request.connection.remoteAddress.toString().replace("::ffff:", "");
        cur_ip = ip;

        if (typeof usersList[socket.id] != 'undefined') {
            var useridoff = usersList[socket.id].userid;
            pgquery("UPDATE connections SET dateoff = current_timestamp, bytesread = $3, byteswrite = $4 WHERE dateoff IS NULL AND conid = $1 AND userid = $2::uuid", [socket.id, useridoff, socket.request.client.bytesRead, socket.request.client.bytesWritten]);
            log(1, "Отключение сеанса " + socket.id + " пользователь: " + usersList[socket.id].description + " ip: " + ip, useridoff, ip);
            var data = '{"event": "userSplit", "userid": "' + usersList[socket.id].userid + '", "id": "' + socket.id.substring(0, 6) + '"}';
            socket.broadcast.json.binary(false).send(data);
            delete usersList[socket.id];
            sendAnotherProcess(JSON.parse(data));
        }

        auf_clients.splice(auf_clients.indexOf(socket.id), 1);
        socket.disconnect();
    });

    setTimeout(function (socid) {
        if (auf_clients.indexOf(socid) == -1 && typeof io.sockets.connected[socid] != 'undefined')
            io.sockets.connected[socid].disconnect();
    }, 30000, socket.id);
});

process.on('message', function (packet) {
    var data = packet.data.message;
    if (data.event == "userAdd" || data.event == "userSplit" || data.event == "sendMessage" || data.event == "atachData") {
        for (var key in usersList) {
            if ((usersList[key].userid == data.userid || usersList[key].userid == data.destid) && typeof io.sockets.connected[key] != 'undefined')
                io.sockets.connected[key].binary(false).emit('message', JSON.stringify(data));
        }
    } else if (data.event == "confirmChangeRoom") {
        checkRoomUsers(data);
    } else {
        if (typeof io.sockets.adapter.rooms != 'undefined' && typeof io.sockets.adapter.rooms[data.roomid] != 'undefined')
            io.of('/').to(data.roomid).binary(false).emit('message', JSON.stringify(data));
    }
});

var connections = probe.metric({
    name: 'connections',
    value: function () {
        return auf_clients.length;
    }
});

var deburl = probe.metric({
    name: 'deburl',
    value: function () {
        return inspector.url();
    }
});

