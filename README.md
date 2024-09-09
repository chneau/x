```bash
apt update
apt install -y curl git unzip sudo
useradd c -mG sudo
echo "c ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/c
su c
# then
curl -fsSL https://bun.sh/install | bash
curl -fsSL raw.githubusercontent.com/chneau/dotfiles/master/bootstrap.sh | sh
bash
bun install -fg @chneau/x
x system
x doctor
x update
```
