import tkinter as tk
from tkinter import messagebox, simpledialog
import json
import socket
import threading
import requests
from datetime import datetime

# Configuration
CONFIG_FILE = "rfid_config.json"
RENDER_URL = "https://rfid-library.onrender.com/api/rfid-update"
PORT = 5000

# Load or initialize config
try:
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
except FileNotFoundError:
    config = {"shelves": [], "return_boxes": []}

# GUI Setup
root = tk.Tk()
root.title("RFID Bridge")
root.geometry("600x400")

# Detected EPCs state
detected_epcs = {}  # {ip: {epc: {last_seen: timestamp, sent: bool}}}

# Log Display
log_frame = tk.Frame(root)
log_frame.pack(fill="x", padx=10, pady=5)
log_label = tk.Label(log_frame, text="EPC Detection Log", font=("Arial", 12, "bold"))
log_label.pack()
log_text = tk.Text(log_frame, height=10, width=70, state="disabled")
log_text.pack(fill="x")

# Boxes Display
boxes_frame = tk.Frame(root)
boxes_frame.pack(fill="x", padx=10, pady=5)
boxes_label = tk.Label(boxes_frame, text="Configured Boxes", font=("Arial", 12, "bold"))
boxes_label.pack()
boxes_list = tk.Listbox(boxes_frame, height=5, width=70)
boxes_list.pack(fill="x")

# Buttons
button_frame = tk.Frame(root)
button_frame.pack(pady=10)
tk.Button(button_frame, text="Add Bookshelf", command=lambda: add_box("shelf")).pack(side="left", padx=5)
tk.Button(button_frame, text="Add Return Box", command=lambda: add_box("return_box")).pack(side="left", padx=5)

def log_message(message):
    log_text.config(state="normal")
    log_text.delete("1.0", tk.END)  # Clear old logs
    log_text.insert(tk.END, f"{datetime.now().strftime('%H:%M:%S')} - {message}\n")
    log_text.config(state="disabled")

def update_boxes_list():
    boxes_list.delete(0, tk.END)
    for shelf in config["shelves"]:
        boxes_list.insert(tk.END, f"Shelf: {shelf['name']} ({shelf['ip']})")
    for box in config["return_boxes"]:
        boxes_list.insert(tk.END, f"Return Box: {box['name']} ({box['ip']})")

def save_config():
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

def add_box(box_type):
    name = simpledialog.askstring("Input", f"Enter {box_type.replace('_', ' ')} name:")
    ip = simpledialog.askstring("Input", f"Enter {box_type.replace('_', ' ')} IP:")
    if name and ip:
        config[f"{box_type}es"].append({"name": name, "ip": ip})
        save_config()
        update_boxes_list()

def extract_epc(data):
    hex_data = data.hex().upper()
    return hex_data[8:20] if len(hex_data) >= 20 else None

def tcp_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(('0.0.0.0', PORT))
    server.listen(5)
    log_message(f"TCP server listening on port {PORT}")

    while True:
        client, addr = server.accept()
        ip = addr[0]
        threading.Thread(target=handle_client, args=(client, ip), daemon=True).start()

def handle_client(client, ip):
    shelf_ips = [s["ip"] for s in config["shelves"]]
    return_box_ips = [s["ip"] for s in config["return_boxes"]]
    box_type = "shelf" if ip in shelf_ips else "return_box" if ip in return_box_ips else None
    if not box_type:
        client.close()
        return

    if ip not in detected_epcs:
        detected_epcs[ip] = {}

    while True:
        try:
            data = client.recv(1024)
            if not data:
                break
            epc = extract_epc(data)
            if epc:
                now = datetime.now().timestamp()
                if epc not in detected_epcs[ip]:
                    detected_epcs[ip][epc] = {"last_seen": now, "sent": False}
                    log_message(f"EPC '{epc}' detected by {box_type} reader {ip}")
                    send_to_render(ip, epc, box_type)
                    detected_epcs[ip][epc]["sent"] = True
                else:
                    detected_epcs[ip][epc]["last_seen"] = now
        except:
            break

    # Check for non-detected EPCs
    now = datetime.now().timestamp()
    for epc in list(detected_epcs[ip].keys()):
        if now - detected_epcs[ip][epc]["last_seen"] > 5:  # 5-second timeout
            if detected_epcs[ip][epc]["sent"]:
                log_message(f"EPC '{epc}' no longer detected by {box_type} reader {ip}")
                send_to_render(ip, epc, box_type, detected=False)
            del detected_epcs[ip][epc]

    client.close()

def send_to_render(ip, epc, box_type, detected=True):
    try:
        response = requests.post(RENDER_URL, json={
            "readerIp": ip,
            "epc": epc,
            "type": box_type,
            "detected": detected
        }, headers={"Content-Type": "application/json"})
        log_message(f"EPC '{epc}' {'forwarded to' if detected else 'removed from'} Render from {ip} - Status: {response.status_code}")
    except Exception as e:
        log_message(f"Error sending EPC '{epc}' to Render: {str(e)}")

# Start TCP server in a separate thread
threading.Thread(target=tcp_server, daemon=True).start()

# Initialize UI
update_boxes_list()
root.mainloop()