// Site script. Must NEVER execute inside the Xyle editing preview.
const marker = document.createElement("div");
marker.id = "script-ran";
marker.textContent = "script executed";
document.body.append(marker);
