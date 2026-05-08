import nodemailer from 'nodemailer';

class EmailService {
  private transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  async sendOTP(email: string, otp: string) {
    const mailOptions = {
      from: `"JobsKomzansi" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "OTP for Account Verification",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #3b82f6; text-align: center;">Account Verification</h2>
          <p>Thank you for registering with JobsKomzansi. Please use the following OTP to verify your account:</p>
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <h1 style="margin: 0; font-size: 32px; letter-spacing: 5px; color: #111827;">${otp}</h1>
          </div>
          <p style="color: #6b7280; font-size: 14px;">This OTP will expire in 10 minutes.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; 2026 JobsKomzansi. All rights reserved.</p>
        </div>
      `,
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendEmployerVettingNotification(email: string) {
    const mailOptions = {
      from: `"JobsKomzansi" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Employer Account Verification Pending",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #3b82f6; text-align: center;">Welcome to JobsKomzansi!</h2>
          <p>Your employer account has been created successfully.</p>
          <p><strong>Note:</strong> Our team is currently vetting your account for safety and security. You will be notified via email once your account has been approved, after which you can start posting jobs.</p>
          <p>Thank you for your patience.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; 2026 JobsKomzansi. All rights reserved.</p>
        </div>
      `,
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendEmployerApproved(email: string) {
    const mailOptions = {
      from: `"JobsKomzansi" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Employer Account Approved!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #10b981; text-align: center;">Account Approved</h2>
          <p>Great news! Your employer account has been vetted and approved.</p>
          <p>You can now log in and start posting job listings to find the best talent in South Africa.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:4200/login" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Go to Dashboard</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; 2026 JobsKomzansi. All rights reserved.</p>
        </div>
      `,
    };

    return this.transporter.sendMail(mailOptions);
  }
  async sendWelcomeEmail(email: string, name: string) {
    const mailOptions = {
      from: `"JobsKomzansi" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Welcome to JobsKomzansi!",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #3b82f6; text-align: center;">Welcome, ${name}!</h2>
          <p>We're thrilled to have you join JobsKomzansi – South Africa's premier job platform.</p>
          <p>Your account has been successfully verified. You can now explore thousands of job opportunities or post listings to find your next great hire.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="http://localhost:4200/" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Start Exploring</a>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; 2026 JobsKomzansi. All rights reserved.</p>
        </div>
      `,
    };

    return this.transporter.sendMail(mailOptions);
  }

  async sendEmployerRejected(email: string, reason: string) {
    const mailOptions = {
      from: `"JobsKomzansi" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Employer Account Verification Update",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #ef4444; text-align: center;">Account Verification Update</h2>
          <p>Thank you for your interest in JobsKomzansi.</p>
          <p>After reviewing your employer account application, we are unable to approve your account at this time for the following reason:</p>
          <div style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #ef4444; margin: 20px 0;">
            <p style="margin: 0; color: #b91c1c; font-weight: bold;">${reason}</p>
          </div>
          <p>If you believe this is an error or would like to provide more information, please contact our support team.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #9ca3af; text-align: center;">&copy; 2026 JobsKomzansi. All rights reserved.</p>
        </div>
      `,
    };

    return this.transporter.sendMail(mailOptions);
  }
}

export const emailService = new EmailService();
