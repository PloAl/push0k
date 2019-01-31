var config = require('./config');
var starterConfig = require('./starter_cfg');
var crypto = require('crypto');
var server = {};
var fs = require('fs');
var connectionId = "";
var os = require('os');
var cpusarray = os.cpus();
var bunList = new Map();
var serverId = crypto.createHash('md5').update(os.hostname()).update(process.cwd()).digest('hex');
var versions = { nodejs: "", postgreSQL: "", pg: "", socketio: "", pm2: "", push0k: "", pgErr: false, socketioErr: false, pm2Err: false, push0kErr: false };
try {
    versions.pg = require("pg/package").version;
    const { Pool } = require('pg');
    var pool = new Pool(starterConfig.pgconf);
} catch (err) {
    versions.pgErr = true;
}
try {
    versions.socketio = require("socket.io/package").version;
} catch (err) {
    versions.socketioErr = true;
}
try {
    versions.pm2 = require("pm2/package").version;
    var pm2 = require('pm2');
    pm2.connect(true, function (err) {
        if (err) {
            console.error(err);
            process.exit(2);
        }
    });
} catch (err) {
    versions.pm2Err = true;
}
try {
    versions.push0k = require("./package.json").version.substr(0, 5);
} catch (err) {
    versions.push0kErr = true;
}
versions.nodejs = process.versions.node;
config.catalog = process.cwd();

function SendResult(datastr, resp) {
    resp.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datastr, 'utf8') });
    resp.end(datastr);
}

function saveconfig(res) {
    var confTxt = "var config = " + JSON.stringify(config, "", 4) + ";" + "\nmodule.exports = config;";
    fs.writeFile(process.cwd() + '/config.js', confTxt, function (err) {
        if (err) {
            SendResult('{"event": "uncaughtException","PID": "' + process.pid + '","err": "' + err + '"}', res);
        }
    });
}

function checkConnection(res, trycount) {

    var checkResult = {};
    pool.connect(async (err, client, release) => {
        if (err) {
            release();
            pool.end();
            const { Pool } = require('pg');
            pool = new Pool(starterConfig.pgconf);
            saveconfig(res);
            if (!trycount)
                checkResult = checkConnection(res, trycount + 1);
            else
                SendResult('{"event": "setPgConfig","err": "' + err.toString() + '"}', res);
            return;
        }
        const result = await client.query("SELECT usersadm.userscount,roomsadm.roomscount,current_setting('server_version') AS ver, (SELECT array_to_json(array(SELECT json_build_object('refid',refid,'description',description) FROM public.roomscat WHERE description != ''))) as rooms  FROM \
                        (SELECT count(userid) AS userscount FROM users_roomscat WHERE roomid IN(SELECT refid FROM roomscat WHERE roomtype=7)) AS usersadm,\
                        (SELECT count(refid) AS roomscount FROM roomscat WHERE roomtype=7) AS roomsadm;");
        release();

        if (result.rows.length > 0) {
            versions.postgreSQL = result.rows[0].ver;
            checkResult = { event: "pgconnect", success: true, errtext: "", userscount: parseInt(result.rows[0].userscount), roomscount: parseInt(result.rows[0].roomscount) };
        }
        else
            checkResult = { event: "pgconnect", success: true, errtext: "", userscount: 0, version: '' };


        if (!checkResult.success || checkResult.userscount == 0 || checkResult.roomscount == 0) {
            SendResult(JSON.stringify(checkResult), res);
            return;
        }

        connectionId = crypto.randomBytes(14);
        SendResult('{"event": "connection","conid": "' + connectionId.toString('hex') + '","versions": ' + JSON.stringify(versions) + ',"rooms": ' + JSON.stringify(result.rows[0].rooms) + ', "hostname": "' + os.hostname() + '", "serverid": "' + serverId + '"}', res);
        setTimeout(function () {
            connectionId = "";
        }, 3000);

    });
}

function updateSeverDev(userid) {

    pool.connect(async (err, client, release) => {
        if (err) {
            return console.error('Error acquiring client', err.stack);
        }
        const result = await client.query("SELECT refid as devid FROM devicecat WHERE refid = $1::uuid;", [serverId]);
        if (err) {
            return console.error('Error executing devicecat query', err.stack);
        }
        var querytext = "";

        var queryparams = [serverId, false, serverId, os.hostname(), os.type() + " " + os.arch(), os.release(), process.versions.node, cpusarray[0].model, os.totalmem(), cpusarray.length, cpusarray[0].speed, cpusarray[0].model, userid];
        if (result.rowCount)
            querytext = "UPDATE devicecat SET code=$3::uuid, description=$4, platformtype=$5, osversion=$6, appversion=$7, processor=$8, memory=$9, servercore=$10, servercpufrequency=$11, servercpu=$12, changestamp=current_timestamp, userid=$13::uuid \
                                WHERE refid = $1 and (description <> $4 or marked <> $2 or platformtype <> $5 or osversion <> $6 or appversion <> $7 or processor <> $8 or memory <> $9 or servercore <> $10 or servercpufrequency <> $11 or servercpu <> $12);";
        else
            querytext = "INSERT INTO devicecat (refid, marked, code, description, platformtype, osversion, appversion, processor, memory, servercore, servercpufrequency, servercpu,useragentinformation, changestamp, userid) VALUES ($1::uuid,$2,$3::uuid,$4, $5,$6,$7,$8,$9,$10,$11,$12,'',current_timestamp,$13::uuid);";

        await client.query(querytext, queryparams);
        release();
    });

}

function getProcessInfo(processList) {
    var procarr = "[";
    for (let i = 0; i < processList.length; i++)
        procarr = procarr + (procarr == "[" ? "" : ",") + '{"name": "' + processList[i].name + '","pid":' + processList[i].pid + ',"pm_id":' + processList[i].pm_id + ',"memory":' + (processList[i].monit.memory / 1024 / 1024) + ',"cpu":' + processList[i].monit.cpu + ',"pm_uptime":' + processList[i].pm2_env.pm_uptime + ',"status":"' + processList[i].pm2_env.status + '","connections":' + (typeof processList[i].pm2_env.axm_monitor.connections == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.connections.value) + ',"net_ul":"' + (typeof processList[i].pm2_env.axm_monitor['Network In'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network In'].value) + '","net_dl":"' + (typeof processList[i].pm2_env.axm_monitor['Network Out'] == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor['Network Out'].value) + '","HTTP":"' + (typeof processList[i].pm2_env.axm_monitor.HTTP == 'undefined' ? 0 : processList[i].pm2_env.axm_monitor.HTTP.value) + '", "deburl":"' + processList[i].pm2_env.axm_monitor.deburl.value + '"}';

    return procarr + ']';
}

async function startServer(data,client,release,res,userid,result,ip) {
    data.config.catalog = process.cwd();
    config = data.config;
    var args = "";
    if (config.debug)
        args = "--inspect";
    pm2.start({script: 'push0k.js', exec_mode: 'cluster', interpreterArgs: args, instances: config.proccount, log_type: 'json', log_date_format: 'YYYY-MM-DD HH:mm:ss Z'}, async function (err, apps) {
        if (err) {
            return SendResult('{"event": "uncaughtException","err": "' + err + '"}', res);
        }
        var querytext = "INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid) VALUES (localtimestamp, $1, $2, $3, $4, $5) ";
        var queryparams = [0, crypto.randomBytes(16).toString("hex"), "Запущен сервер pid: " + apps[0].process.pid + " порт: " + config.port + " pm2 id: " + apps[0].pm2_env.pm_id + " Пользователь: " + result.rows[0].description, ip, userid];
        for (let i = 1; i < apps.length; i++){
            querytext = querytext + ", (localtimestamp, $1, $"+(queryparams.length+1)+", $"+(queryparams.length+2)+", $4, $5) ";
            queryparams.push(crypto.randomBytes(16).toString("hex"));
            queryparams.push("Запущен сервер pid: " + apps[i].process.pid + " порт: " + config.port + " pm2 id: " + apps[i].pm2_env.pm_id + " Пользователь: " + result.rows[0].description);
        }
        await client.query(querytext, queryparams);
        release();
        var appsStr = JSON.stringify(apps).replace(/\(x86\)/g, "_x86_");
        SendResult('{"event": "' + data.event + '","apps": ' + appsStr.replace(/Loop delay/g, "Loop_delay") + '}', res);
        saveconfig(res);
        updateSeverDev(userid);
        return;
    });
}

async function serverFunc(data,client,release,res,userid,result,ip) {
    if (data.event == 'statusServer') {
        pm2.list(function (err, processDescriptionList) {
            release();
            if (err) {
                return SendResult('{"event": "uncaughtException","err": "' + err + '"}', res);
            }
            return SendResult('{"event": "statusServer","userid":"' + userid + '","processDescriptionList": ' + getProcessInfo(processDescriptionList) + ',"config": ' + JSON.stringify(config) + '}', res);
        });
    } else if (data.event == 'startServer') {
        startServer(data,client,release,res,userid,result,ip);
    } else if (data.event == 'stopServer' || data.event == 'restartServer') {
        pm2.delete("all", async function (err, proc) {
            if (err) {
                release();
                return SendResult('{"event": "uncaughtException","err": "' + err + '"}', res);
            }
            await client.query("UPDATE connections SET dateoff = localtimestamp WHERE dateoff IS NULL", []);
            var querytext = "INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid) VALUES (localtimestamp, $1, $2, $3, $4, $5) ";
            var queryparams = [0, crypto.randomBytes(16).toString("hex"), "Остановлен сервер pid: " + data.procs[0] + " порт: " + config.port + " pm2 id: " + proc[0].pm_id + " Пользователь: " + result.rows[0].description, ip, result.rows[0].refid];
            for (let i = 1; i < proc.length; i++){
                querytext = querytext + ", (localtimestamp, $1, $"+(queryparams.length+1)+", $"+(queryparams.length+2)+", $4, $5) ";
                queryparams.push(crypto.randomBytes(16).toString("hex"));
                queryparams.push("Остановлен сервер pid: " + data.procs[i] + " порт: " + config.port + " pm2 id: " + proc[i].pm_id + " Пользователь: " + result.rows[0].description);
            }
            await client.query(querytext, queryparams);
            if (data.event == 'stopServer'){
                release();
                return SendResult('{"event": "stopServer","proc": ' + JSON.stringify(proc).replace(/\(x86\)/g, "_x86_") + '}', res);
            } else
                startServer(data,client,release,res,userid,result,ip);
        });
    } else if (data.event == 'getTestResult') {
        const resultTest = await client.query("SELECT EXTRACT(epoch FROM alldelivery/notifcount) as averagedelivery, EXTRACT(epoch FROM maxdelivery) as maxdelivery, EXTRACT(epoch FROM mindelivery) as mindelivery, EXTRACT(epoch FROM maxmesdate-minmesdate) as mestime, EXTRACT(epoch FROM maxwritedate-mindeliverytime) as deliverytime,EXTRACT(epoch FROM maxdeliverydate-minmesdate) as fulltime,EXTRACT(epoch FROM maxwritedate-minmesdate) as fulltimewithpg, maxdeliverydate, minmesdate, maxwritedate, mes1.mescount as mescount, notifcount, deliverycount,'testResult' as event, storedResult.objectstr as saveResult FROM \
            (SELECT SUM(tmstamp - mes.date) AS alldelivery, MAX(tmstamp - mes.date) AS maxdelivery, MIN(tmstamp - mes.date) AS mindelivery, MAX(mes.date) AS maxmesdate, MIN(mes.date) AS minmesdate, MIN(tmstamp) AS mindeliverytime, MAX(tmstamp) AS maxwritedate, MAX(tmstamp) AS maxdeliverydate, count(1) as notifcount, count(1) as deliverycount FROM public.notifications as notif \
            INNER JOIN(SELECT mesid, tmstamp as date FROM public.messages WHERE extdata LIKE $1) AS mes ON mes.mesid = notif.mesid) AS notif1, \
            (SELECT count(1) as mescount FROM public.messages WHERE extdata LIKE $1) AS mes1, (SELECT objectstr FROM public.versions WHERE refid = $1::uuid) AS storedResult; ", [data.testid]);
        release();
        if (resultTest.rowCount) {
            SendResult(JSON.stringify(resultTest.rows[0]), res);
        }

    } else if (data.event == 'getTableStatistic') {
        var querytext = "SELECT '" + data.tables[0].name + "' as tablename,'" + data.tables[0].namer + "' as name, pg_size_pretty(pg_table_size('" + data.tables[0].name + "')) as tablesize, pg_size_pretty(pg_indexes_size('" + data.tables[0].name + "')) as indexsize,pg_size_pretty(pg_total_relation_size('" + data.tables[0].name + "')) as totalsize, count(1) as rowcount  FROM public." + data.tables[0].name;
        for (let i = 1; i < data.tables.length; i++) {
            querytext = querytext + " UNION SELECT '" + data.tables[i].name + "' as tablename,'" + data.tables[i].namer + "' as name, pg_size_pretty(pg_table_size('" + data.tables[i].name + "')) as tablesize, pg_size_pretty(pg_indexes_size('" + data.tables[i].name + "')) as indexsize,pg_size_pretty(pg_total_relation_size('" + data.tables[i].name + "')) as totalsize, count(1) as rowcount  FROM public." + data.tables[i].name;
        }
        querytext = querytext + " UNION SELECT 'totals' as tablename,'totals' as name, pg_size_pretty(SUM(tablesize)) AS table_size, pg_size_pretty(SUM(indexessize)) AS indexes_size, pg_size_pretty(SUM(totalsize)) AS total_size, 0 as rowcount FROM(SELECT table_name, pg_table_size(table_name) AS tablesize, pg_indexes_size(table_name) AS indexessize, pg_total_relation_size(table_name) AS totalsize FROM information_schema.tables WHERE table_schema = 'public') AS all_tables ORDER BY rowcount DESC, tablesize ASC";
        const resultStatistic = await client.query(querytext);
        release();
        if (resultStatistic.rowCount) {
            SendResult('{"event": "getTableStatistic","result": ' + JSON.stringify(resultStatistic) + '}', res);
        }
    }

}

var requestListener = (req, res) => {

    var body = [];
    req.on('error', function (err) {
        SendResult('{"event": "uncaughtException","PID": "' + process.pid + '","err": "' + err + '"}', res);
    }).on('data', function (chunk) {
        body.push(chunk);
    }).on('end', function () {
        var ip = req.socket.remoteAddress.replace("::ffff:", "");
        body = Buffer.concat(body).toString();
        var data = JSON.parse(body);
        if (versions.pgErr || versions.socketioErr || versions.pm2Err || versions.push0kErr) {
            SendResult('{"event": "moduleErr","versions": ' + JSON.stringify(versions) + ',"err": "' + '' + '"}', res);
            return;
        }

        if (data.event == 'connect') {
            checkConnection(res, 0);
            return;
        }

        if (data.event != 'statusServer' && data.event != 'startServer' && data.event != 'restartServer' && data.event != 'stopServer' && data.event != 'getTestResult' && data.event != 'getTableStatistic' && data.event != 'setPas') {
            SendResult('{"event": "uncaughtException","PID": "' + process.pid + '","err": "' + encodeURIComponent('Неподдерживаемое событие ' + JSON.stringify(data)) + '"}', res);
            return;
        }
        if (data.event != 'startServer' && data.config.https){
            let cert = fs.existsSync(data.config.cert);
            let key = fs.existsSync(data.config.key);
            let ca = fs.existsSync(data.config.ca);
            let checkResullt = data.config.rejectUnauthorized ? (cert && key && ca) : (cert && key);
            if (!checkResullt)
                SendResult('{"event": "certErr","cert": ' + cert + ',"key": ' + key + ',"ca": ' + ca + '}', res);
        }
        let bunDate = bunList.get(data.usr + ip);
        if (typeof bunDate != 'undefined' && bunDate >= new Date()) {
            return SendResult('{"event": "blockUser","user": "' + data.usr + '"}', res);
        }
        pool.connect(async (err, client, release) => {
            if (err) {
                return SendResult('{"event": "auferror","err": "' + err.toString() + '"}', res);
            }
            const result = await client.query("SELECT userscat.refid,userscat.pwd,userscat.tmppwd,userscat.description,users_roomscat.roomid as admroom FROM userscat LEFT JOIN users_roomscat ON userscat.refid = users_roomscat.userid LEFT JOIN roomscat ON roomscat.refid = users_roomscat.roomid WHERE userscat.code = $1 AND roomscat.roomtype=7", [data.usr]);

            let auf = false;
            if (result.rows.length) {
                var hash = require('crypto').createHash('sha256').update(result.rows[0].pwd.toString()).update(connectionId.toString('hex')).digest('hex');
                if (hash === data.pwd) {
                    auf = true;
                    if (result.rows[0].tmppwd !== '' && data.event !== 'setPas') {
                        release();
                        return SendResult('{"event":"newPasRequired","id":"' + connectionId.toString('hex') + '"}', res);
                    }
                }
            }
            if (!auf) {
                SendResult('{"event": "auferror","err": "' + '' + '"}', res);
                var usid = null;
                if (result.rows.length > 0)
                    usid = result.rows[0].refid;

                await client.query("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid, usercode) VALUES (localtimestamp, $1, $2, $3, $4, $5, $6)", [6, crypto.randomBytes(16).toString("hex"), "Безуспешная попытка авторизации пользователя: " + (result.rowCount ? result.rows[0].description : data.usr) + " ip: " + ip, ip, usid, data.usr]);
                if (config.blockusers && usid != "") {
                    const resrow = await client.query("SELECT count(1) as failcount FROM logs WHERE logtype = 6 AND userid =$1::uuid AND ipadress = $2 AND tmstamp >= current_timestamp - interval '" + config.failauftime + " second';", [usid, ip]);

                    if (resrow.rows.length && resrow.rows[0].failcount >= config.failaufcount) {
                        let blockDate = new Date();
                        blockDate.setTime(blockDate.getTime() + config.blocktime*1000);
                        bunList.set(data.usr + ip, blockDate);
                        client.query("INSERT INTO logs (tmstamp, logtype, logid, description, ipadress, userid) VALUES (localtimestamp, $1, $2, $3, $4, $5)", [6, crypto.randomBytes(16).toString("hex"), "Заблокирован пользователь: " + (result.rowCount ? result.rows[0].description : data.usr) + " ip: " + ip, ip, usid]);
                    }
                }
                release();
                return;
            }
            var userid = result.rows[0].refid;
            if (data.event === 'setPas') {
                var decipher = crypto.createDecipher('aes256', result.rows[0].pwd.replace(/([ ])/g, "") + connectionId.toString('hex'));
                var npas = decipher.update(data.npas,'hex','utf8');
                npas += decipher.final('utf8');
                await client.query("UPDATE userscat SET pwd = $1, tmppwd = $2 WHERE refid = $3::uuid", [npas, "", userid]);
                release();
                return SendResult('{"event": "setPasConfirm", "required":' + (result.rows[0].tmppwd !== '') + ',"id":"' + connectionId.toString('hex') + '"}', res);
            }
            serverFunc(data,client,release,res,userid,result,ip);
        });

    });
};

if (!starterConfig.https) {
    server = require('http').createServer(requestListener).listen(starterConfig.port);
} else {
    var tls = require('tls');
    if (starterConfig.rejectUnauthorized) {
        var certs = {};
        certs[starterConfig.hostname] = { secureProtocol: "TLSv1_2_method", key: fs.readFileSync(process.cwd() + "\\" + starterConfig.key), cert: fs.readFileSync(process.cwd() + "\\" + starterConfig.cert), ca: fs.readFileSync(process.cwd() + "\\" + starterConfig.ca), requestCert: true, rejectUnauthorized: starterConfig.rejectUnauthorized };
        var httpsOptions = { SNICallback: function (hostname, cb) { var ctx = tls.createSecureContext(certs[hostname]); cb(null, ctx); }, key: fs.readFileSync(process.cwd() + "\\" + starterConfig.key), cert: fs.readFileSync(process.cwd() + "\\" + starterConfig.cert), ca: fs.readFileSync(process.cwd() + "\\" + starterConfig.ca) };
        server = require('https').createServer(httpsOptions, requestListener);
    } else {
        if (starterConfig.ca != '') {
            server = require('https').createServer({ key: fs.readFileSync(starterConfig.key), cert: fs.readFileSync(starterConfig.cert), ca: fs.readFileSync(starterConfig.ca), requestCert: true, rejectUnauthorized: starterConfig.rejectUnauthorized }, requestListener);
        } else {
            server = require('https').createServer({ key: fs.readFileSync(starterConfig.key), cert: fs.readFileSync(starterConfig.cert), requestCert: false, rejectUnauthorized: starterConfig.rejectUnauthorized }, requestListener);
        }
    }
    server.listen(starterConfig.port);
}

if (config.autostart) {
    pm2.start({
        script: 'push0k.js',
        exec_mode: 'cluster',
        instances: config.proccount
    });
}
