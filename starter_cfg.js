var config = {
	"port": 2016,
	"https": true,
    "rejectUnauthorized": true,
    "key": "privkey_.pem",
    "cert": "cert_.pem",
    "ca": "chain_.pem",
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