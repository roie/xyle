// Site script. Must NEVER execute inside the Xyle editing preview.
document.title = "MUTATED-BY-SCRIPT";
const marker = document.createElement("div");
marker.id = "script-ran";
marker.textContent = "script executed";
document.body.append(marker);
