# Quick Start AWS Deployment

Get your game running on AWS in under 10 minutes!

## Prerequisites
- AWS Account
- SSH key pair

## Steps

### 1. Launch EC2 Instance (5 minutes)

1. Go to [EC2 Console](https://console.aws.amazon.com/ec2/)
2. Click **Launch Instance**
3. Configure:
   - **Name**: `cybertabletop`
   - **AMI**: Amazon Linux 2023
   - **Instance Type**: `t3.micro` (Free tier eligible!)
   - **Key Pair**: Create new or select existing
   - **Network**: Create security group:
     - **HTTP (80)**: `0.0.0.0/0`
     - **Backend (8000)**: `0.0.0.0/0`
     - **SSH (22)**: Your IP
   - **Storage**: 20GB (default)
4. Click **Launch Instance**

### 2. Connect and Deploy (3 minutes)

```bash
# Connect (replace with your key and IP)
ssh -i your-key.pem ec2-user@YOUR_EC2_IP

# Run these commands on the EC2 instance:
cd /opt
sudo git clone https://github.com/zerop0wn/cybertabletopgame.git
sudo chown -R $USER:$USER cybertabletopgame
cd cybertabletopgame
chmod +x aws/deploy.sh
./aws/deploy.sh
```

### 3. Access Your Game (1 minute)

Open in browser: `http://YOUR_EC2_IP`

**Default GM Login:**
- Username: `admin`
- Password: `admin` (change this in `/opt/cybertabletop/.env`!)

## Cost

- **t3.micro**: ~$8-10/month (or free for 12 months with AWS Free Tier)
- **Storage**: ~$2/month
- **Total**: ~$10/month (or $2/month with Free Tier)

## Next Steps

- Change admin password in `.env`
- Set up domain with SSL (see `aws/README.md`)
- Monitor logs: `docker-compose -f docker-compose.prod.yml logs -f`

## Troubleshooting

**Can't access?**
- Check security group allows HTTP (80) and backend (8000)
- Verify instance has public IP

**Services not starting?**
```bash
cd /opt/cybertabletop
docker-compose -f docker-compose.prod.yml logs
```

**Need help?** See `aws/README.md` for detailed guide.


