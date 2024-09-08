```bash
apt update
apt install -y curl git unzip sudo
useradd c -mG sudo
echo "c ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/c
su c
# then
curl -fsSL https://bun.sh/install | bash
export PATH=$PATH:~/.bun/bin
bun install -fg @chneau/x
x system
x doctor
x update
```
