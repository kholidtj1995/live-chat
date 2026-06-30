import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDskehF5n_IJuuUsGWQEFBmjM80uCSDEyM",
  authDomain: "live-chat-ea070.firebaseapp.com",
  projectId: "live-chat-ea070",
  storageBucket: "live-chat-ea070.firebasestorage.app",
  messagingSenderId: "321161064947",
  appId: "1:321161064947:web:53603c0e1be0b3baf66286"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let isLogin = false;

window.toggleMode = () => {
    isLogin = !isLogin;
    document.getElementById("title").innerText = isLogin ? "Вуруд ба барнома" : "Сабти ном";
    document.getElementById("mainBtn").innerText = isLogin ? "Даромадан" : "Сабти ном";
    document.getElementById("name").style.display = isLogin ? "none" : "block";
};

document.getElementById("mainBtn").addEventListener("click", async () => {
    const phone = document.getElementById("phone").value;
    const password = document.getElementById("password").value;
    const name = document.getElementById("name").value;
    const email = `${phone}@mychat.com`; // Рақами телефон ҳамчун почта истифода мешавад

    try {
        if (isLogin) {
            await signInWithEmailAndPassword(auth, email, password);
            alert("Бомуваффақият ворид шудед!");
        } else {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", userCredential.user.uid), { name, phone });
            alert("Сабти ном анҷом ёфт!");
        }
    } catch (error) {
        alert("Хатогӣ: " + error.message);
    }
});