export type public_room = {
    roomName : string
}

export type private_room = {
    roomName : string
    createTime : string
}

export type chatMessage = {
    sendTime : string
    userID : string
    contents : string
}

export type User = {
    socketID : string
    userID : string
}

export type UserinRoom = {
    roomName : string
    roomType : string
}