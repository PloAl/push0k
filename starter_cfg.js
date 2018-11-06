var config = {
	"port": 2016,
	"https": false,
    "rejectUnauthorized": false,
    "key": "privkey.pem",
    "cert": "cert.pem",
    "ca": "chain.pem",
    "hostname": "push0k.ru",
	"pgconf": {
        "user": "postgres",
        "host": "192.168.0.10",
        "database": "push0k",
        "password": "postgresghj",
        "port": 5444
    }
};
module.exports = config;