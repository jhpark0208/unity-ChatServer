process.env['NODE_CONFIG_DIR'] = __dirname + '/configs';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import config from 'config';
import express from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import morgan from 'morgan';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Routes } from '@interfaces/routes.interface';
import errorMiddleware from '@middlewares/error.middleware';
import { logger, stream } from '@utils/logger';
import socketIO from 'socket.io';
import * as redis from 'redis';
import { debug } from 'winston';

class App {
  public app: express.Application;
  public port: string | number;
  public env: string;
  public server: any;
  public io : socketIO.Server;
  public redisClient : redis.RedisClient;


  constructor(routes: Routes[]) {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.env = process.env.NODE_ENV || 'development';
    this.redisClient = redis.createClient({
      host : "127.0.0.1",
      port : 6379
    });
    
    this.redisClient.flushall();
    this.redisClient.rpush("rooms:public", "room1", "room2"); 
    this.initializeMiddlewares();
    this.initializeRoutes(routes);
    this.initializeSwagger();
    this.initializeErrorHandling();
  }

  public listen() {
    this.server = this.app.listen(this.port, () => {
      logger.info(`=================================`);
      logger.info(`======= ENV: ${this.env} =======`);
      logger.info(`🚀 App listening on the port ${this.port}`);
      logger.info(`=================================`);
    });
    
    this.redisClient.on('error', function(err) {
      console.log("Error on Redis" + err);
    });

    this.io = new socketIO.Server(this.server,{
      transports : ['websocket']
    });

    this.io.on('connection', (socket) => {
      console.log('user connect');

      this.redisClient.lrange("rooms:public", 0, -1, (err, arr) => {
        socket.emit('initroomlist', {
          msg: arr.toString()
        });
      })

      socket.on('makePrivateRoomRequest', (RoomName, users) => {
        console.log(RoomName, users);

        var user : string[];
        user = users.split(',');
        for(var i = 0; i < user.length;i++){
          var u = user[i].split(':');
          console.log(u);

          this.io.to(u[1]).emit('roomInvite', {
            msg : RoomName
          })
        }
      })

      socket.on('inviteApprove', (RoomName, name) => {
        this.redisClient.rpush(name + ":rooms", (res) => {
          socket.emit('initroomlist', {
            msg : RoomName
          })
        })
      })

      socket.on("setUserName", (name) => {
        console.log(name);
        this.redisClient.sadd('connectUsers', socket.id + '&' + name);
      });

      socket.on('join', (RoomName, name) =>{
        var time = this.getFormatDate(new Date());
        this.redisClient.rpush(
          'message:'+ RoomName,
          time + " " + name + " join " + RoomName,
          (res) => {
            this.redisClient.lrange('message:' + RoomName, 0, -1, (err, arr) => {
              arr.forEach((element, index) => {
                if(index == arr.length - 1){
                  this.io.to(RoomName).emit('roomChatMessage', {
                    msg : RoomName + "/" + element
                  });
                }
                else{
                  socket.emit("roomChatMessage", {
                    msg : RoomName + '/' + element
                  })
                }
              });
            });
          } 
        );
        socket.join(RoomName);        
      });
      
      socket.on('sendMessage', (RoomName, name, Message) => {
        console.log(RoomName, name, Message);
        var time = this.getFormatDate(new Date());
        this.redisClient.rpush(
          'message:' + RoomName,
          time + " " + name + " : " + Message,
          (res) => {
            this.redisClient.lrange('message:' + RoomName, -1, -1, (err, arr) => {
              this.io.to(RoomName).emit("roomChatMessage", {
                msg : RoomName + '/' + arr.toString()
              })
            })
          }
        );
      });

      socket.on('leaveRoom', (RoomName, name) => {
        console.log(name + " leave " + RoomName);
        var time = this.getFormatDate(new Date());
        this.redisClient.rpush(
          'message:' + RoomName,
          time + " " + name + " leave " + RoomName,
          (res) => {
            this.redisClient.lrange('message:' + RoomName, -1, -1, (err,arr) =>{
              this.io.to(RoomName).emit('roomChatMessage', {
                msg : RoomName + "/" + arr.toString()
              });
            })
          }
        );
        socket.leave(RoomName);
      });

      socket.on('getconnectedList', () => {
        this.redisClient.smembers("connectUsers", (err, arr) =>{
          // console.log(arr);
          socket.emit('connectedList', {
            msg : arr.toString()
          });
        });
      });

      socket.on('sendMessageIndividual', (from, to, id, Message) => {
        console.log(from, to, id, Message);
        socket.to(id).emit("individualChatMessage", {
          msg : from + ',' + Message
        });
      });

      socket.on('disconnect', () =>{
        console.log(socket.id + " disconnect");
        this.redisClient.smembers('connectUsers', (err, arr) =>{
          var t : any;
          arr.forEach(element => {
            if(element.split('&')[0] == socket.id)
              t = element;
          });
          this.redisClient.srem('connectUsers', t, () => {
            socket.broadcast.emit('disconnectUser', {
              msg : t.split('&')[1]
            });
          })
        })
      });
    })
  }

  public getFormatDate_ymd(date: Date){
    var year = date.getFullYear();
    var _month = (1 + date.getMonth());
    var month = _month >= 10 ? _month : '0' + _month;
    var _day = date.getDate();
    var day = _day >= 10 ? _day : '0' + _day;
    return year + '-' + month + '-' + day;
  }

  public getFormatDate(date: Date){
    var year = date.getFullYear();
    var _month = (1 + date.getMonth());
    var month = _month >= 10 ? _month : '0' + _month;
    var _day = date.getDate();
    var day = _day >= 10 ? _day : '0' + _day;
    var _hour = date.getHours();
    var hour = _hour >= 10 ? _hour : '0' + _hour;
    var _min = date.getMinutes();
    var min = _min >= 10 ? _min : '0' + _min;
    var _sec = date.getSeconds();
    var sec = _sec >= 10 ? _sec : '0' + _sec;
    return '[' + year + '-' + month + '-' + day + '-' + hour + '-' + min + '-' + sec + ']';
  }

  public getServer() {
    return this.app;
  }

  private initializeMiddlewares() {
    this.app.use(morgan(config.get('log.format'), { stream }));
    this.app.use(cors({ origin: config.get('cors.origin'), credentials: config.get('cors.credentials') }));
    this.app.use(hpp());
    this.app.use(helmet());
    this.app.use(compression());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cookieParser());
  }

  private initializeRoutes(routes: Routes[]) {
    routes.forEach(route => {
      this.app.use('/', route.router);
    });
  }

  private initializeSwagger() {
    const options = {
      swaggerDefinition: {
        info: {
          title: 'REST API',
          version: '1.0.0',
          description: 'Example docs',
        },
      },
      apis: ['swagger.yaml'],
    };

    const specs = swaggerJSDoc(options);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
  }

  private initializeErrorHandling() {
    this.app.use(errorMiddleware);
  }
}

export default App;
