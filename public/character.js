let sensitivity = 0.004
let yaw = 0
let pitch = 0
let distance = 20
let distVECTOR3 = make_vector3(distance, distance, distance)
let limit = 0
let char = ""

console.log(distVECTOR3)

function onstep() {
    const down = window.MOUSE_STATE?.buttons?.get(2) === true
    if (down) {
        document.body.requestPointerLock();
        yaw -= (window.deltaX * sensitivity)
        pitch -= (window.deltaY * sensitivity)
        limit = 80 * (Math.PI / 180)
        pitch = Math.min(Math.max(pitch, 0-limit), limit);
    } else {
        document.exitPointerLock();
    }
    charpos = GAMEMODEL[char]["props"]["CFrame"]

    requestAnimationFrame(onstep);
}

requestAnimationFrame(onstep);

const handler = async (name, data) => {
    console.warn(name, data)   
     
};

recieve_from_server.add(handler);
console.log(recieve_from_server)
tell_server_im_ready()