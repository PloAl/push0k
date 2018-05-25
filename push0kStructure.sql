--
-- PostgreSQL database dump
--

-- Dumped from database version 9.6.8
-- Dumped by pg_dump version 10.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = off;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;
SET escape_string_warning = off;
SET row_security = off;

--
-- Name: plpgsql; Type: EXTENSION; Schema: -; Owner: 
--

CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;


--
-- Name: EXTENSION plpgsql; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';


--
-- Name: add_users_contact(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.add_users_contact() RETURNS trigger
    LANGUAGE plpgsql LEAKPROOF
    AS $$    BEGIN
		INSERT INTO users_contacts (userid, contactid, description, changestamp) SELECT refid, NEW.refid,NEW.description, current_timestamp FROM userscat;
		INSERT INTO users_contacts (userid, contactid, description, changestamp) SELECT NEW.refid, refid, description, current_timestamp FROM userscat;
        RETURN NEW;
    END;

$$;


ALTER FUNCTION public.add_users_contact() OWNER TO postgres;

--
-- Name: save_version(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.save_version() RETURNS trigger
    LANGUAGE plpgsql LEAKPROOF
    AS $$    BEGIN
		IF TG_TABLE_NAME = 'users_contacts' THEN
			INSERT INTO versions (stamptime,userid,typeid,refid,objectstr) VALUES(OLD.changestamp,OLD.userid,MD5(TG_TABLE_NAME)::uuid,OLD.contactid,row_to_json(OLD));
		ELSE
			INSERT INTO versions (stamptime,userid,typeid,refid,objectstr) VALUES(OLD.changestamp,OLD.userid,MD5(TG_TABLE_NAME)::uuid,OLD.refid,row_to_json(OLD));
		END IF;		
		NEW.changestamp	= current_timestamp;
        RETURN NEW;
    END;

$$;


ALTER FUNCTION public.save_version() OWNER TO postgres;

--
-- Name: update_room_users(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_room_users() RETURNS trigger
    LANGUAGE plpgsql LEAKPROOF
    AS $$    BEGIN
		IF (TG_OP = 'INSERT') THEN
			INSERT INTO users_roomscat (userid, roomid, lineno, rowid, admin) 
				SELECT * FROM jsonb_populate_recordset(null::users_roomscat, NEW.users);
		ELSIF OLD.users != NEW.users THEN
			DELETE FROM users_roomscat WHERE roomid = OLD.refid;
			INSERT INTO users_roomscat (userid, roomid, lineno, rowid, admin) 
				SELECT * FROM jsonb_populate_recordset(null::users_roomscat, NEW.users);
		END IF;	
        RETURN NEW;
    END;

$$;


ALTER FUNCTION public.update_room_users() OWNER TO postgres;

--
-- Name: write_notification(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.write_notification() RETURNS trigger
    LANGUAGE plpgsql LEAKPROOF
    AS $$    BEGIN
		IF (NEW.roomid IS NULL) THEN
			INSERT INTO notifications (mesid, userid, baseid, usrdevid) 
				SELECT DISTINCT NEW.mesid, userid, baseid, usrdevid FROM connections 
					WHERE baseid != NEW.baseid AND baseid != MD5('push0kAdminPush0k Admin')::uuid 
						AND userid IN (NEW.userid, NEW.destid);
		ELSIF (NEW.roomid IS NOT NULL) THEN
			INSERT INTO notifications (mesid, userid, baseid, usrdevid) 
				SELECT DISTINCT NEW.mesid, userid, baseid, usrdevid FROM connections 
					WHERE baseid != NEW.baseid AND baseid != MD5('push0kAdminPush0k Admin')::uuid 
						AND userid IN (SELECT userid FROM users_roomscat WHERE roomid = NEW.roomid);
		END IF;				
        RETURN NULL;
    END;
$$;


ALTER FUNCTION public.write_notification() OWNER TO postgres;

SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: basescat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.basescat (
    refid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    description character varying(256) NOT NULL,
    baseref character varying(1024) NOT NULL,
    baseversion character varying(256) NOT NULL,
    code character varying(36) DEFAULT ''::character varying NOT NULL,
    marked boolean DEFAULT false NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    changestamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL
);


ALTER TABLE public.basescat OWNER TO postgres;

--
-- Name: connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.connections (
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    conid character(22) NOT NULL,
    dateon timestamp with time zone NOT NULL,
    dateoff timestamp with time zone,
    baseid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    ipadress character varying(16) NOT NULL,
    usrdevid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    contime numeric(5,0) DEFAULT 0 NOT NULL,
    auftime numeric(5,0) DEFAULT 0 NOT NULL,
    datasintime numeric(5,0) DEFAULT 0 NOT NULL,
    datasize numeric(16,0) DEFAULT 0 NOT NULL,
    https boolean NOT NULL,
    procid integer DEFAULT 0 NOT NULL,
    serverid uuid,
    bytesread numeric(16,0) DEFAULT 0 NOT NULL,
    byteswrite numeric(16,0) DEFAULT 0 NOT NULL,
    useragent character varying(25) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE public.connections OWNER TO postgres;

--
-- Name: datasend; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.datasend (
    dataid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    conid character(22) NOT NULL,
    filename character varying(256) NOT NULL,
    filesize numeric(16,0) NOT NULL,
    starttime numeric(20,0) NOT NULL,
    endtime numeric(20,0) NOT NULL,
    tmstamp timestamp with time zone NOT NULL,
    timems numeric(10,0) NOT NULL,
    speedmb numeric(16,8) DEFAULT 0 NOT NULL,
    https boolean NOT NULL,
    onecver character varying(15) DEFAULT ''::character varying NOT NULL,
    nodejsver character varying(15) NOT NULL,
    socketiover character varying(15) NOT NULL,
    serverid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    datatype numeric(1,0) NOT NULL,
    upload boolean DEFAULT false NOT NULL,
    diskfilesize numeric(16,0) DEFAULT 0 NOT NULL,
    conntype numeric(1,0) DEFAULT 0 NOT NULL,
    devtype numeric(1,0) DEFAULT 0 NOT NULL
);


ALTER TABLE public.datasend OWNER TO postgres;

--
-- Name: devicecat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.devicecat (
    refid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    marked boolean NOT NULL,
    code character varying(36) NOT NULL,
    description character varying(50) NOT NULL,
    platformtype character varying(50) NOT NULL,
    osversion character varying(100) NOT NULL,
    appversion character varying(50) NOT NULL,
    useragentinformation character varying(50) NOT NULL,
    processor character varying(100) NOT NULL,
    memory numeric(16,0) NOT NULL,
    servercore numeric(5,0) NOT NULL,
    servercpufrequency numeric(5,0) NOT NULL,
    servercpu character varying(50) NOT NULL,
    userid uuid,
    changestamp timestamp with time zone DEFAULT make_timestamptz(1, 1, 1, 0, 0, (0)::double precision, 'utc'::text) NOT NULL
);


ALTER TABLE public.devicecat OWNER TO postgres;

--
-- Name: logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs (
    logid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    logtype numeric(1,0) NOT NULL,
    tmstamp timestamp with time zone NOT NULL,
    description character varying NOT NULL,
    ipadress character varying(16) NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    conid character(22)
);


ALTER TABLE public.logs OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.messages (
    tmstamp timestamp with time zone NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    destid uuid,
    mesid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    roomid uuid,
    message character varying NOT NULL,
    datatype numeric(1,0) NOT NULL,
    extdata character varying NOT NULL,
    devtype numeric(1,0) NOT NULL,
    datasize numeric(16,0) NOT NULL,
    conid character(22) DEFAULT ''::bpchar NOT NULL,
    parentid uuid
);


ALTER TABLE public.messages OWNER TO postgres;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    tmstamp timestamp with time zone,
    mesid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    baseid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    usrdevid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    logtype numeric(1,0) DEFAULT 0 NOT NULL
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: numberinfo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.numberinfo (
    country numeric(3,0) DEFAULT 7 NOT NULL,
    code numeric(3,0) NOT NULL,
    snumber numeric(7,0) NOT NULL,
    enumber numeric(7,0) NOT NULL,
    capacity numeric(8,0) NOT NULL,
    operator character varying(256) NOT NULL,
    region character varying(256) NOT NULL,
    fullnumstart numeric(13,0) DEFAULT 0 NOT NULL,
    fullnumend numeric(13,0) DEFAULT 0 NOT NULL
);


ALTER TABLE public.numberinfo OWNER TO postgres;

--
-- Name: registration; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.registration (
    tmstamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL,
    number character varying(20) NOT NULL,
    description character varying(25) NOT NULL,
    usersign character varying(256) NOT NULL,
    icon character varying DEFAULT ''::character varying NOT NULL,
    userid uuid NOT NULL,
    code numeric(13,0) DEFAULT NULL::numeric NOT NULL,
    result_stamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL,
    result_userid uuid NOT NULL,
    result_reg boolean NOT NULL,
    result_desc character varying(256)
);


ALTER TABLE public.registration OWNER TO postgres;

--
-- Name: roomscat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roomscat (
    refid uuid NOT NULL,
    marked boolean DEFAULT false NOT NULL,
    code character varying(36) NOT NULL,
    description character varying(25) NOT NULL,
    extdesc character varying NOT NULL,
    roomtype numeric(1,0) DEFAULT 0 NOT NULL,
    icon character varying DEFAULT ''::character varying NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    changestamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL,
    users jsonb,
    objectid uuid,
    objtype uuid
);


ALTER TABLE public.roomscat OWNER TO postgres;

--
-- Name: users_contacts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users_contacts (
    userid uuid NOT NULL,
    contactid uuid NOT NULL,
    description character varying(50),
    blocknotifications boolean DEFAULT false NOT NULL,
    blockmessages boolean DEFAULT false NOT NULL,
    changestamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL
);


ALTER TABLE public.users_contacts OWNER TO postgres;

--
-- Name: users_roomscat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users_roomscat (
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    roomid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    lineno numeric(5,0) NOT NULL,
    rowid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    admin boolean DEFAULT false NOT NULL
);


ALTER TABLE public.users_roomscat OWNER TO postgres;

--
-- Name: userscat; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.userscat (
    refid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    marked boolean DEFAULT false NOT NULL,
    number character varying(20) NOT NULL,
    description character varying(25) NOT NULL,
    pwd character varying NOT NULL,
    usersign character varying(256) NOT NULL,
    tmppwd character varying NOT NULL,
    icon character varying DEFAULT ''::character varying NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    changestamp timestamp with time zone DEFAULT '0001-01-01 00:00:00'::timestamp without time zone NOT NULL,
    code numeric(13,0) DEFAULT NULL::numeric NOT NULL
);


ALTER TABLE public.userscat OWNER TO postgres;

--
-- Name: versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.versions (
    stamptime timestamp with time zone NOT NULL,
    userid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    typeid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    refid uuid DEFAULT '00000000-0000-0000-0000-000000000000'::uuid NOT NULL,
    objectstr jsonb NOT NULL
);


ALTER TABLE public.versions OWNER TO postgres;

--
-- Name: basescat basescat_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.basescat
    ADD CONSTRAINT basescat_pkey PRIMARY KEY (refid);


--
-- Name: devicecat devicecat_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.devicecat
    ADD CONSTRAINT devicecat_pkey PRIMARY KEY (refid);


--
-- Name: roomscat roomscat_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roomscat
    ADD CONSTRAINT roomscat_pkey PRIMARY KEY (refid);


--
-- Name: userscat userscat_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.userscat
    ADD CONSTRAINT userscat_pkey PRIMARY KEY (refid);


--
-- Name: basescat_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX basescat_code ON public.basescat USING btree (code, refid);


--
-- Name: basescat_descr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX basescat_descr ON public.basescat USING btree (description, refid);


--
-- Name: connections_by_dateoff; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX connections_by_dateoff ON public.connections USING btree (dateoff, userid, conid);


--
-- Name: connections_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX connections_bydims ON public.connections USING btree (userid, conid);

ALTER TABLE public.connections CLUSTER ON connections_bydims;


--
-- Name: datasend_by_upload_dataid_conid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX datasend_by_upload_dataid_conid ON public.datasend USING btree (upload, dataid, conid);


--
-- Name: datasend_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX datasend_bydims ON public.datasend USING btree (tmstamp, dataid, conid);

ALTER TABLE public.datasend CLUSTER ON datasend_bydims;


--
-- Name: devicecat_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX devicecat_code ON public.devicecat USING btree (code, refid);


--
-- Name: devicecat_descr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX devicecat_descr ON public.devicecat USING btree (description, refid);


--
-- Name: logs_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX logs_bydims ON public.logs USING btree (logid, logtype, tmstamp);

ALTER TABLE public.logs CLUSTER ON logs_bydims;


--
-- Name: messages_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX messages_bydims ON public.messages USING btree (tmstamp, userid, destid, mesid, roomid);

ALTER TABLE public.messages CLUSTER ON messages_bydims;


--
-- Name: notifications_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX notifications_bydims ON public.notifications USING btree (tmstamp, mesid, userid, baseid, usrdevid);

ALTER TABLE public.notifications CLUSTER ON notifications_bydims;


--
-- Name: roomcat_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX roomcat_type ON public.roomscat USING btree (roomtype, refid);


--
-- Name: roomscat_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX roomscat_code ON public.roomscat USING btree (code, refid);


--
-- Name: roomscat_descr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX roomscat_descr ON public.roomscat USING btree (description, refid);


--
-- Name: users_contacts_bydims; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_contacts_bydims ON public.users_contacts USING btree (userid, contactid);

ALTER TABLE public.users_contacts CLUSTER ON users_contacts_bydims;


--
-- Name: users_roomscat_byowner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_roomscat_byowner ON public.users_roomscat USING btree (userid, roomid);


--
-- Name: users_roomscat_intkeyind; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_roomscat_intkeyind ON public.users_roomscat USING btree (roomid, rowid);

ALTER TABLE public.users_roomscat CLUSTER ON users_roomscat_intkeyind;


--
-- Name: userscat_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX userscat_code ON public.userscat USING btree (code, refid);


--
-- Name: userscat_descr; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX userscat_descr ON public.userscat USING btree (description, refid);


--
-- Name: userscat addcontacts; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER addcontacts AFTER INSERT ON public.userscat FOR EACH ROW EXECUTE PROCEDURE public.add_users_contact();


--
-- Name: userscat savevers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER savevers BEFORE UPDATE ON public.userscat FOR EACH ROW EXECUTE PROCEDURE public.save_version();


--
-- Name: basescat savevers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER savevers BEFORE UPDATE ON public.basescat FOR EACH ROW EXECUTE PROCEDURE public.save_version();


--
-- Name: devicecat savevers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER savevers BEFORE UPDATE ON public.devicecat FOR EACH ROW EXECUTE PROCEDURE public.save_version();


--
-- Name: roomscat savevers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER savevers BEFORE UPDATE ON public.roomscat FOR EACH ROW EXECUTE PROCEDURE public.save_version();


--
-- Name: users_contacts savevers; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER savevers BEFORE UPDATE ON public.users_contacts FOR EACH ROW EXECUTE PROCEDURE public.save_version();


--
-- Name: roomscat update_users; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users BEFORE INSERT OR UPDATE ON public.roomscat FOR EACH ROW EXECUTE PROCEDURE public.update_room_users();


--
-- PostgreSQL database dump complete
--

